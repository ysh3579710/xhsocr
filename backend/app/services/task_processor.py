from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
import re
import time

from sqlalchemy import select

from app.core.config import settings
from app.db.session import SessionLocal
from app.models.entities import (
    Batch,
    Book,
    BookSegment,
    Task,
    TaskImage,
    TaskLog,
    TaskResult,
    TaskStatus,
    TaskType,
)
from app.services.ai_writer import (
    LLMClient,
    render_prompt_template,
)
from app.services.llm_settings import get_active_llm_model
from app.services.book_matcher import match_book_segments
from app.services.ocr import extract_text_with_timeout, get_ocr_service


def _log(db, task_id: int, stage: str, level: str, message: str) -> None:
    db.add(TaskLog(task_id=task_id, stage=stage, level=level, message=message))


def _log_and_commit(db, task: Task, stage: str, level: str, message: str) -> None:
    _log(db, task.id, stage, level, message)
    task.updated_at = datetime.now(timezone.utc)
    db.commit()


def _refresh_batch_status(db, batch_id: int) -> None:
    batch = db.get(Batch, batch_id)
    if not batch:
        return

    tasks = db.execute(select(Task).where(Task.batch_id == batch_id)).scalars().all()
    total = len(tasks)
    success_count = sum(1 for t in tasks if t.status == TaskStatus.success)
    failed_count = sum(1 for t in tasks if t.status == TaskStatus.failed)

    batch.total_count = total
    batch.success_count = success_count
    batch.failed_count = failed_count

    if total > 0 and success_count + failed_count == total:
        batch.status = TaskStatus.success if failed_count == 0 else TaskStatus.failed
    elif any(t.status == TaskStatus.processing for t in tasks):
        batch.status = TaskStatus.processing
    else:
        batch.status = TaskStatus.waiting


def _prepare_create_book_context(db, book_id: int | None, limit: int = 6) -> tuple[str, str]:
    if not book_id:
        return "未绑定书稿", ""
    book = db.get(Book, book_id)
    if not book:
        return "未绑定书稿", ""
    segments = (
        db.execute(
            select(BookSegment).where(BookSegment.book_id == book_id).order_by(BookSegment.segment_index.asc()).limit(limit)
        )
        .scalars()
        .all()
    )
    text = "\n\n".join([s.content for s in segments])
    return book.title, text


def _extract_outline_with_internal_prompt(llm: LLMClient, original_note_text: str) -> tuple[str, str, str]:
    extract_prompt = (
        "请从下列文本中提取“大标题”和“分点观点标题”，并严格只输出 JSON，格式如下：\n"
        '{"title":"...","points":["...","..."]}\n'
        "要求：\n"
        "1) 只能输出 JSON，不要输出任何其他文字。\n"
        "2) title 必须是一个字符串。\n"
        "3) points 必须是字符串数组。\n\n"
        f"{original_note_text}"
    )
    raw = llm.chat(extract_prompt).strip()
    try:
        payload = json.loads(raw)
    except Exception as exc:
        raise RuntimeError("提取标题或分点观点时出错") from exc

    if not isinstance(payload, dict):
        raise RuntimeError("提取标题或分点观点时出错")

    title = str(payload.get("title", "")).strip()
    points_raw = payload.get("points", [])
    if not isinstance(points_raw, list):
        raise RuntimeError("提取标题或分点观点时出错")

    points = [str(p).strip() for p in points_raw if isinstance(p, str) and str(p).strip()]

    # Title must not be empty and must not be an enumerated list-like content.
    numbered_like = re.match(r"^\s*(\d+[\.、]|[一二三四五六七八九十]+[、\.])", title) is not None
    if not title or numbered_like:
        raise RuntimeError("提取标题或分点观点时出错")
    if not points:
        raise RuntimeError("提取标题或分点观点时出错")

    points_text = "\n".join([f"{idx + 1}. {p}" for idx, p in enumerate(points)])
    outline = f"大标题：{title}\n分点观点：\n{points_text}".strip()
    return title, points_text, outline


def _collapse_blank_lines(text: str) -> str:
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    # Remove empty lines between paragraphs: keep only single line breaks.
    normalized = re.sub(r"\n[ \t]*\n+", "\n", normalized)
    return normalized.strip()


def process_task(task_id: int) -> None:
    db = SessionLocal()
    try:
        task = db.get(Task, task_id)
        if not task:
            return

        task.status = TaskStatus.processing
        task.error_message = None
        task.llm_model = get_active_llm_model(db)
        _log(db, task_id, "queue", "info", "Task started.")
        if task.batch_id:
            _refresh_batch_status(db, task.batch_id)
        db.commit()

        if task.task_type == TaskType.create:
            if not task.title or not task.title.strip():
                raise RuntimeError("Create task title is required.")
            if not task.prompt_snapshot:
                raise RuntimeError("Create task prompt snapshot is missing.")

            result = db.get(TaskResult, task_id)
            if not result:
                result = TaskResult(task_id=task_id)
                db.add(result)

            book_title, matched_segments_text = _prepare_create_book_context(db, task.book_id)
            llm = LLMClient(model=task.llm_model)

            create_prompt = render_prompt_template(
                task.prompt_snapshot,
                {
                    "title": task.title,
                    "book_title": book_title,
                    "matched_segments": matched_segments_text,
                    "original_note": "",
                    "rewritten_note": "",
                },
            )

            created_text = _collapse_blank_lines(llm.chat(create_prompt).strip())
            result.rewritten_note = created_text
            result.full_output = created_text
            result.original_note_text = None
            result.matched_book_segments = None
            result.intro_text = None
            result.fixed_tags_text = None
            result.random_tags_text = None
            result.extracted_title = None
            result.extracted_points_text = None

            _log_and_commit(db, task, "create", "info", "Create generation finished.")
            task.status = TaskStatus.success
            if task.batch_id:
                _refresh_batch_status(db, task.batch_id)
            db.commit()
            return

        if task.book_id is None:
            raise RuntimeError("OCR task book_id is required.")
        if not task.prompt_snapshot:
            raise RuntimeError("OCR task prompt snapshot is missing.")

        images = (
            db.execute(
                select(TaskImage).where(TaskImage.task_id == task_id).order_by(TaskImage.sort_index.asc())
            )
            .scalars()
            .all()
        )
        if not images:
            raise RuntimeError("No images found for task.")

        task_root = Path(settings.task_root)
        missing = []
        for image in images:
            if not (task_root / image.file_path).exists():
                missing.append(image.file_name)
        if missing:
            raise RuntimeError(f"Task image files missing: {', '.join(missing)}")

        ocr_service = get_ocr_service()
        if ocr_service.configured_provider == "paddleocr" and ocr_service.provider == "mock":
            _log_and_commit(
                db,
                task,
                "ocr",
                "warning",
                ocr_service.downgrade_reason
                or "OCR provider auto-downgraded to mock due to runtime compatibility policy.",
            )

        ocr_outputs = []
        total_images = len(images)
        for idx, image in enumerate(images, start=1):
            image_path = task_root / image.file_path
            _log_and_commit(
                db,
                task,
                "ocr",
                "info",
                f"OCR start {idx}/{total_images}: {image.file_name}",
            )
            started = time.perf_counter()
            try:
                text = extract_text_with_timeout(image_path, settings.ocr_timeout_seconds)
            except Exception as exc:
                raise RuntimeError(f"OCR failed on `{image.file_name}`: {exc}") from exc
            ocr_outputs.append(text)
            elapsed = time.perf_counter() - started
            _log_and_commit(
                db,
                task,
                "ocr",
                "info",
                f"OCR done {idx}/{total_images}: {image.file_name} ({elapsed:.2f}s, {len(text)} chars)",
            )

        result = db.get(TaskResult, task_id)
        if not result:
            result = TaskResult(task_id=task_id)
            db.add(result)

        # Keep raw OCR output: no auto-cleanup/no correction.
        original_note_text = "\n".join(ocr_outputs)
        result.original_note_text = original_note_text

        segments = (
            db.execute(
                select(BookSegment).where(BookSegment.book_id == task.book_id).order_by(BookSegment.segment_index.asc())
            )
            .scalars()
            .all()
        )
        matched = match_book_segments(
            note_text=original_note_text,
            segments=[{"segment_index": s.segment_index, "content": s.content} for s in segments],
        )
        result.matched_book_segments = matched
        _log_and_commit(
            db,
            task,
            "match",
            "info",
            f"Book matching finished with {len(matched.get('top_segments', []))} segment(s).",
        )

        book = db.get(Book, task.book_id)
        book_title = book.title if book else "未命名书稿"
        matched_segments = matched.get("top_segments", [])
        llm = LLMClient(model=task.llm_model)

        if task.task_type == TaskType.framework:
            title, points_text, outline = _extract_outline_with_internal_prompt(llm, original_note_text)
            result.extracted_title = title
            result.extracted_points_text = points_text
            _log_and_commit(db, task, "extract", "info", "Outline extraction finished.")
            final_prompt = render_prompt_template(
                task.prompt_snapshot,
                {
                    "title": title,
                    "points": points_text,
                    "outline": outline,
                    "original_note": original_note_text,
                    "book_title": book_title,
                    "matched_segments": "\n\n".join([s["content"] for s in matched_segments]),
                    "rewritten_note": "",
                },
            )
            final_text = llm.chat(final_prompt).strip()
            _log_and_commit(db, task, "compose", "info", "Framework compose generation finished.")
        else:
            result.extracted_title = None
            result.extracted_points_text = None
            final_prompt = render_prompt_template(
                task.prompt_snapshot,
                {
                    "title": task.title or "",
                    "points": "",
                    "outline": "",
                    "original_note": original_note_text,
                    "book_title": book_title,
                    "matched_segments": "\n\n".join([s["content"] for s in matched_segments]),
                    "rewritten_note": "",
                },
            )
            final_text = llm.chat(final_prompt).strip()
        final_text = _collapse_blank_lines(final_text)
        result.rewritten_note = final_text
        result.intro_text = None
        result.fixed_tags_text = None
        result.random_tags_text = None
        result.full_output = final_text
        _log_and_commit(db, task, "write", "info", "Single prompt generation finished.")

        task.status = TaskStatus.success
        _log(db, task_id, "ocr", "info", "OCR finished successfully.")
        if task.batch_id:
            _refresh_batch_status(db, task.batch_id)
        db.commit()

    except Exception as exc:
        db.rollback()
        task = db.get(Task, task_id)
        if task:
            task.status = TaskStatus.failed
            task.error_message = str(exc)
            _log(db, task_id, "queue", "error", str(exc))
            if task.batch_id:
                _refresh_batch_status(db, task.batch_id)
            db.commit()
        raise
    finally:
        db.close()
