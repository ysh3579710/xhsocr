from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import random
import time

from sqlalchemy import select

from app.core.config import settings
from app.db.session import SessionLocal
from app.models.entities import (
    Batch,
    Book,
    BookSegment,
    PromptType,
    TagLibrary,
    Task,
    TaskImage,
    TaskLog,
    TaskResult,
    TaskStatus,
    TaskType,
)
from app.services.ai_writer import (
    LLMClient,
    build_intro_prompt,
    build_rewrite_prompt,
    render_prompt_template,
)
from app.services.llm_settings import get_active_llm_model
from app.services.book_matcher import match_book_segments
from app.services.ocr import extract_text_with_timeout, get_ocr_service
from app.services.prompt_service import get_active_version
from app.services.tag_settings import get_fixed_tags


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

            result = db.get(TaskResult, task_id)
            if not result:
                result = TaskResult(task_id=task_id)
                db.add(result)

            book_title, matched_segments_text = _prepare_create_book_context(db, task.book_id)
            llm = LLMClient(model=task.llm_model)

            create_tpl = get_active_version(db, PromptType.create)
            if create_tpl:
                create_prompt = render_prompt_template(
                    create_tpl.content,
                    {
                        "title": task.title,
                        "book_title": book_title,
                        "matched_segments": matched_segments_text,
                        "original_note": "",
                        "rewritten_note": "",
                    },
                )
            else:
                create_prompt = (
                    "请基于标题创作一篇小红书原创正文。\n"
                    f"标题：{task.title}\n"
                    f"参考书稿：{book_title}\n"
                    f"可用书稿片段：\n{matched_segments_text}\n\n"
                    "请直接输出原创正文。"
                )

            created_text = llm.chat(create_prompt).strip()
            result.rewritten_note = created_text
            result.full_output = created_text
            result.original_note_text = None
            result.matched_book_segments = None
            result.intro_text = None
            result.fixed_tags_text = None
            result.random_tags_text = None

            _log_and_commit(db, task, "create", "info", "Create generation finished.")
            task.status = TaskStatus.success
            if task.batch_id:
                _refresh_batch_status(db, task.batch_id)
            db.commit()
            return

        if task.book_id is None:
            raise RuntimeError("OCR task book_id is required.")

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

        rewrite_default = build_rewrite_prompt(original_note_text, book_title, matched_segments)
        rewrite_tpl = get_active_version(db, PromptType.rewrite)
        if rewrite_tpl:
            rewrite_prompt = render_prompt_template(
                rewrite_tpl.content,
                {
                    "original_note": original_note_text,
                    "book_title": book_title,
                    "matched_segments": "\n\n".join([s["content"] for s in matched_segments]),
                },
            )
        else:
            rewrite_prompt = rewrite_default
        rewritten_note = llm.chat(rewrite_prompt).strip()
        result.rewritten_note = rewritten_note
        _log_and_commit(db, task, "rewrite", "info", "Rewrite generation finished.")

        intro_default = build_intro_prompt(rewritten_note)
        intro_tpl = get_active_version(db, PromptType.intro)
        if intro_tpl:
            intro_prompt = render_prompt_template(
                intro_tpl.content,
                {
                    "rewritten_note": rewritten_note,
                },
            )
        else:
            intro_prompt = intro_default
        intro_text = llm.chat(intro_prompt).strip()
        result.intro_text = intro_text
        if len(intro_text) < 100 or len(intro_text) > 150:
            _log_and_commit(
                db,
                task,
                "intro",
                "warning",
                f"Intro length is {len(intro_text)} (expected 100-150). No retry by design.",
            )
        else:
            _log_and_commit(db, task, "intro", "info", "Intro generation finished within length range.")

        fixed_tags = get_fixed_tags(db)

        enabled_tags = (
            db.execute(select(TagLibrary).where(TagLibrary.enabled.is_(True)).order_by(TagLibrary.id.asc()))
            .scalars()
            .all()
        )
        pool = [t.tag_text.strip().lstrip("#") for t in enabled_tags if t.tag_text and t.tag_text.strip()]
        random_tags: list[str] = []
        if len(pool) >= 10:
            random_tags = random.choices(pool, k=10)
        elif len(pool) > 0:
            random_tags = [random.choice(pool) for _ in range(10)]

        result.fixed_tags_text = " ".join([f"#{t}" for t in fixed_tags])
        result.random_tags_text = " ".join([f"#{t}" for t in random_tags])
        result.full_output = (
            f"{rewritten_note}\n\n"
            f"{intro_text}\n\n"
            f"{result.fixed_tags_text}\n"
            f"{result.random_tags_text}"
        )
        _log_and_commit(db, task, "tags", "info", "Tags generation finished.")

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
