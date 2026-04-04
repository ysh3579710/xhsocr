from __future__ import annotations

import io
import json
import re
import shutil
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional
from urllib.parse import quote
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.config import settings
from app.db.deps import get_db
from app.models.entities import Batch, BatchType, Book, Prompt, Task, TaskImage, TaskLog, TaskResult, TaskStatus, TaskType
from app.schemas.tasks import (
    CreateTaskBatchIn,
    TaskBindingIn,
    TaskCreateOut,
    TaskDetailOut,
    TaskDownloadBatchIn,
    TaskFullOutputUpdateIn,
    TaskImageOut,
    TaskItemOut,
)
from app.services.task_queue import enqueue_task
from app.utils.sort import natural_sort_key

router = APIRouter(prefix="/tasks", tags=["tasks"])

ALLOWED_IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp"}
IGNORED_FILE_NAMES = {"Thumbs.db", "desktop.ini"}


def _sanitize_filename_part(value: str) -> str:
    text = re.sub(r"[\\/:*?\"<>|\r\n\t]+", "_", value.strip())
    text = re.sub(r"\s+", "_", text)
    text = text.strip("._")
    return text[:80] if text else "untitled"


def _filename_timestamp_suffix() -> str:
    sh_tz = timezone(timedelta(hours=8))
    return datetime.now(sh_tz).strftime("%Y%m%d_%H%M%S")


def _single_download_filename(task: Task) -> str:
    task_type = task.task_type.value
    suffix = _filename_timestamp_suffix()
    if task.task_type.name == "create":
        title = _sanitize_filename_part(task.title or "untitled")
        return f"{task_type}_{task.id}_{title}_{suffix}.txt"
    title_line = ""
    if task.result and task.result.full_output:
        first_line = task.result.full_output.replace("\r\n", "\n").replace("\r", "\n").split("\n", 1)[0]
        title_line = _sanitize_filename_part(first_line)
    if not title_line:
        raise HTTPException(status_code=400, detail="最终文本第一行为空，无法生成下载文件名。")
    return f"{task_type}_{task.id}_{title_line}_{suffix}.txt"


def _zip_download_filename(task_types: set[str]) -> str:
    suffix = _filename_timestamp_suffix()
    if len(task_types) == 1:
        only = next(iter(task_types))
    else:
        only = "mixed"
    return f"xhsocr_export_{only}_{suffix}.zip"


def _ascii_filename_fallback(file_name: str) -> str:
    # HTTP header `filename=` must be latin-1 safe in Starlette.
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", file_name).strip("._")
    return safe or "download.txt"


def _content_disposition_header(file_name: str) -> str:
    fallback = _ascii_filename_fallback(file_name)
    encoded = quote(file_name, safe="")
    return f"attachment; filename=\"{fallback}\"; filename*=UTF-8''{encoded}"


def _task_to_item(task: Task, db: Session) -> TaskItemOut:
    book_name = task.book_title_snapshot
    if book_name is None and task.book_id is not None:
        book = db.get(Book, task.book_id)
        book_name = book.title if book else None
    return TaskItemOut(
        id=task.id,
        task_type=task.task_type.value,
        title=task.title,
        batch_id=task.batch_id,
        folder_name=task.folder_name,
        book_id=task.book_id,
        book_name=book_name,
        prompt_id=task.prompt_id,
        prompt_name=task.prompt.name if task.prompt else None,
        llm_model=task.llm_model,
        download_count=(task.result.download_count if task.result else 0),
        status=task.status.value,
        error_message=task.error_message,
        retry_count=task.retry_count,
        created_at=task.created_at,
    )


def _extract_folder_name(filename: str) -> str:
    normalized = filename.replace("\\", "/").strip("/")
    parts = normalized.split("/")
    if len(parts) < 2:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file path `{filename}`. Expected directory upload preserving relative path.",
        )
    return parts[0]


def _should_ignore_file(filename: str) -> bool:
    normalized = filename.replace("\\", "/").strip("/")
    base_name = Path(normalized).name
    if not base_name:
        return True
    if base_name.startswith("."):
        return True
    if base_name in IGNORED_FILE_NAMES:
        return True
    if normalized.startswith("__MACOSX/"):
        return True
    return False


def _refresh_batch_after_task_change(db: Session, batch_id: int) -> None:
    batch = db.get(Batch, batch_id)
    if not batch:
        return

    tasks = db.execute(select(Task).where(Task.batch_id == batch_id)).scalars().all()
    total = len(tasks)
    if total == 0:
        db.delete(batch)
        return

    success_count = sum(1 for t in tasks if t.status == TaskStatus.success)
    failed_count = sum(1 for t in tasks if t.status == TaskStatus.failed)
    processing_count = sum(1 for t in tasks if t.status == TaskStatus.processing)

    batch.total_count = total
    batch.success_count = success_count
    batch.failed_count = failed_count

    if success_count + failed_count == total:
        batch.status = TaskStatus.success if failed_count == 0 else TaskStatus.failed
    elif processing_count > 0:
        batch.status = TaskStatus.processing
    else:
        batch.status = TaskStatus.waiting


@router.post("", response_model=TaskCreateOut, status_code=status.HTTP_201_CREATED)
def create_tasks(
    bindings: str = Form(..., description="JSON array: [{folder_name, book_id}]"),
    files: list[UploadFile] = File(...),
    prompt_id: int = Form(...),
    batch_name: Optional[str] = Form(default=None),
    auto_enqueue: bool = Form(default=True),
    db: Session = Depends(get_db),
) -> TaskCreateOut:
    try:
        parsed = json.loads(bindings)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="`bindings` must be valid JSON.")

    try:
        binding_items = [TaskBindingIn.model_validate(item) for item in parsed]
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid bindings payload.")

    if not binding_items:
        raise HTTPException(status_code=400, detail="At least one folder binding is required.")
    if not files:
        raise HTTPException(status_code=400, detail="At least one image file is required.")

    binding_map: dict[str, int] = {}
    for item in binding_items:
        folder_name = item.folder_name.strip()
        if not folder_name:
            raise HTTPException(status_code=400, detail="folder_name cannot be empty.")
        if folder_name in binding_map:
            raise HTTPException(status_code=400, detail=f"Duplicate binding folder: {folder_name}")
        binding_map[folder_name] = item.book_id

    exists_books = set(
        db.execute(select(Book.id).where(Book.id.in_(set(binding_map.values())))).scalars().all()
    )
    if exists_books != set(binding_map.values()):
        raise HTTPException(status_code=400, detail="Some book_id does not exist.")
    books = db.execute(select(Book).where(Book.id.in_(set(binding_map.values())))).scalars().all()
    book_title_map = {b.id: b.title for b in books}

    prompt = db.get(Prompt, prompt_id)
    if not prompt:
        raise HTTPException(status_code=400, detail="prompt_id not found.")
    if not prompt.enabled:
        raise HTTPException(status_code=400, detail="Prompt is disabled and cannot be selected.")

    files_by_folder: dict[str, list[UploadFile]] = {}
    for up in files:
        if not up.filename:
            raise HTTPException(status_code=400, detail="Uploaded file missing filename.")
        if _should_ignore_file(up.filename):
            continue
        folder_name = _extract_folder_name(up.filename)
        ext = Path(up.filename).suffix.lower()
        if ext not in ALLOWED_IMAGE_EXT:
            raise HTTPException(status_code=400, detail=f"Unsupported image type: {up.filename}")
        files_by_folder.setdefault(folder_name, []).append(up)

    missing = [name for name in binding_map if name not in files_by_folder]
    if missing:
        raise HTTPException(status_code=400, detail=f"No files found for folders: {', '.join(missing)}")

    if len(files_by_folder) != len(binding_map):
        extra = [name for name in files_by_folder if name not in binding_map]
        if extra:
            raise HTTPException(status_code=400, detail=f"Files include unbound folders: {', '.join(extra)}")

    batch: Optional[Batch] = None
    if len(binding_map) > 1:
        batch = Batch(
            batch_name=(batch_name or "batch").strip() or "batch",
            batch_type=BatchType.ocr,
            total_count=len(binding_map),
            success_count=0,
            failed_count=0,
            status=TaskStatus.waiting,
        )
        db.add(batch)
        db.flush()

    created_tasks: list[Task] = []
    for folder_name, book_id in binding_map.items():
        task = Task(
            task_type=TaskType.ocr,
            batch_id=batch.id if batch else None,
            folder_name=folder_name,
            book_id=book_id,
            book_title_snapshot=book_title_map.get(book_id),
            prompt_id=prompt.id,
            prompt_snapshot=prompt.content,
            status=TaskStatus.waiting,
        )
        db.add(task)
        created_tasks.append(task)
    db.flush()

    task_root = Path(settings.task_root)
    task_root.mkdir(parents=True, exist_ok=True)

    for task in created_tasks:
        folder_files = files_by_folder[task.folder_name]
        folder_files.sort(key=lambda f: natural_sort_key(Path(f.filename or "").name))

        for idx, up in enumerate(folder_files, start=1):
            original_name = Path(up.filename or "").name
            ext = Path(original_name).suffix.lower()
            safe_name = f"{idx:03d}_{uuid4().hex}{ext}"
            relative_path = Path(str(task.id)) / safe_name
            absolute_path = task_root / relative_path
            absolute_path.parent.mkdir(parents=True, exist_ok=True)

            content = up.file.read()
            if not content:
                raise HTTPException(status_code=400, detail=f"Empty file: {up.filename}")
            absolute_path.write_bytes(content)

            db.add(
                TaskImage(
                    task_id=task.id,
                    file_name=original_name,
                    sort_index=idx,
                    file_path=str(relative_path),
                )
            )

    db.commit()

    if auto_enqueue:
        for task in created_tasks:
            try:
                enqueue_task(task.id)
            except Exception as exc:
                db.add(
                    TaskLog(
                        task_id=task.id,
                        stage="queue",
                        level="error",
                        message=f"Enqueue failed: {exc}",
                    )
                )
        db.commit()
    return TaskCreateOut(
        batch_id=batch.id if batch else None,
        task_ids=[task.id for task in created_tasks],
        total_count=len(created_tasks),
    )


@router.post("/framework", response_model=TaskCreateOut, status_code=status.HTTP_201_CREATED)
def create_framework_tasks(
    bindings: str = Form(..., description="JSON array: [{folder_name, book_id}]"),
    files: list[UploadFile] = File(...),
    prompt_id: int = Form(...),
    batch_name: Optional[str] = Form(default=None),
    auto_enqueue: bool = Form(default=True),
    db: Session = Depends(get_db),
) -> TaskCreateOut:
    try:
        parsed = json.loads(bindings)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="`bindings` must be valid JSON.")

    try:
        binding_items = [TaskBindingIn.model_validate(item) for item in parsed]
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid bindings payload.")

    if not binding_items:
        raise HTTPException(status_code=400, detail="At least one folder binding is required.")
    if not files:
        raise HTTPException(status_code=400, detail="At least one image file is required.")

    binding_map: dict[str, int] = {}
    for item in binding_items:
        folder_name = item.folder_name.strip()
        if not folder_name:
            raise HTTPException(status_code=400, detail="folder_name cannot be empty.")
        if folder_name in binding_map:
            raise HTTPException(status_code=400, detail=f"Duplicate binding folder: {folder_name}")
        binding_map[folder_name] = item.book_id

    exists_books = set(
        db.execute(select(Book.id).where(Book.id.in_(set(binding_map.values())))).scalars().all()
    )
    if exists_books != set(binding_map.values()):
        raise HTTPException(status_code=400, detail="Some book_id does not exist.")
    books = db.execute(select(Book).where(Book.id.in_(set(binding_map.values())))).scalars().all()
    book_title_map = {b.id: b.title for b in books}

    prompt = db.get(Prompt, prompt_id)
    if not prompt:
        raise HTTPException(status_code=400, detail="prompt_id not found.")
    if not prompt.enabled:
        raise HTTPException(status_code=400, detail="Prompt is disabled and cannot be selected.")

    files_by_folder: dict[str, list[UploadFile]] = {}
    for up in files:
        if not up.filename:
            raise HTTPException(status_code=400, detail="Uploaded file missing filename.")
        if _should_ignore_file(up.filename):
            continue
        folder_name = _extract_folder_name(up.filename)
        ext = Path(up.filename).suffix.lower()
        if ext not in ALLOWED_IMAGE_EXT:
            raise HTTPException(status_code=400, detail=f"Unsupported image type: {up.filename}")
        files_by_folder.setdefault(folder_name, []).append(up)

    missing = [name for name in binding_map if name not in files_by_folder]
    if missing:
        raise HTTPException(status_code=400, detail=f"No files found for folders: {', '.join(missing)}")

    if len(files_by_folder) != len(binding_map):
        extra = [name for name in files_by_folder if name not in binding_map]
        if extra:
            raise HTTPException(status_code=400, detail=f"Files include unbound folders: {', '.join(extra)}")

    batch: Optional[Batch] = None
    if len(binding_map) > 1:
        batch = Batch(
            batch_name=(batch_name or "batch").strip() or "batch",
            batch_type=BatchType.framework,
            total_count=len(binding_map),
            success_count=0,
            failed_count=0,
            status=TaskStatus.waiting,
        )
        db.add(batch)
        db.flush()

    created_tasks: list[Task] = []
    for folder_name, book_id in binding_map.items():
        task = Task(
            task_type=TaskType.framework,
            batch_id=batch.id if batch else None,
            folder_name=folder_name,
            book_id=book_id,
            book_title_snapshot=book_title_map.get(book_id),
            prompt_id=prompt.id,
            prompt_snapshot=prompt.content,
            status=TaskStatus.waiting,
        )
        db.add(task)
        created_tasks.append(task)
    db.flush()

    task_root = Path(settings.task_root)
    task_root.mkdir(parents=True, exist_ok=True)

    for task in created_tasks:
        folder_files = files_by_folder[task.folder_name]
        folder_files.sort(key=lambda f: natural_sort_key(Path(f.filename or "").name))

        for idx, up in enumerate(folder_files, start=1):
            original_name = Path(up.filename or "").name
            ext = Path(original_name).suffix.lower()
            safe_name = f"{idx:03d}_{uuid4().hex}{ext}"
            relative_path = Path(str(task.id)) / safe_name
            absolute_path = task_root / relative_path
            absolute_path.parent.mkdir(parents=True, exist_ok=True)

            content = up.file.read()
            if not content:
                raise HTTPException(status_code=400, detail=f"Empty file: {up.filename}")
            absolute_path.write_bytes(content)

            db.add(
                TaskImage(
                    task_id=task.id,
                    file_name=original_name,
                    sort_index=idx,
                    file_path=str(relative_path),
                )
            )

    db.commit()

    if auto_enqueue:
        for task in created_tasks:
            try:
                enqueue_task(task.id)
            except Exception as exc:
                db.add(
                    TaskLog(
                        task_id=task.id,
                        stage="queue",
                        level="error",
                        message=f"Enqueue failed: {exc}",
                    )
                )
        db.commit()
    return TaskCreateOut(
        batch_id=batch.id if batch else None,
        task_ids=[task.id for task in created_tasks],
        total_count=len(created_tasks),
    )


@router.post("/create-batch", response_model=TaskCreateOut, status_code=status.HTTP_201_CREATED)
def create_title_tasks(payload: CreateTaskBatchIn, db: Session = Depends(get_db)) -> TaskCreateOut:
    titles = [t.strip() for t in payload.titles if t and t.strip()]
    if not titles:
        raise HTTPException(status_code=400, detail="At least one valid title is required.")

    book_title_snapshot = None
    if payload.book_id is not None:
        book = db.get(Book, payload.book_id)
        if not book:
            raise HTTPException(status_code=400, detail="book_id not found.")
        book_title_snapshot = book.title

    prompt = db.get(Prompt, payload.prompt_id)
    if not prompt:
        raise HTTPException(status_code=400, detail="prompt_id not found.")
    if not prompt.enabled:
        raise HTTPException(status_code=400, detail="Prompt is disabled and cannot be selected.")

    batch: Optional[Batch] = None
    if len(titles) > 1:
        batch = Batch(
            batch_name=(payload.batch_name or "batch").strip() or "batch",
            batch_type=BatchType.create,
            total_count=len(titles),
            success_count=0,
            failed_count=0,
            status=TaskStatus.waiting,
        )
        db.add(batch)
        db.flush()

    created_tasks: list[Task] = []
    for title in titles:
        task = Task(
            task_type=TaskType.create,
            title=title,
            folder_name=title,
            book_id=payload.book_id,
            book_title_snapshot=book_title_snapshot,
            prompt_id=prompt.id,
            prompt_snapshot=prompt.content,
            batch_id=batch.id if batch else None,
            status=TaskStatus.waiting,
        )
        db.add(task)
        created_tasks.append(task)

    db.commit()
    for task in created_tasks:
        db.refresh(task)

    if payload.auto_enqueue:
        for task in created_tasks:
            try:
                enqueue_task(task.id)
            except Exception as exc:
                db.add(
                    TaskLog(
                        task_id=task.id,
                        stage="queue",
                        level="error",
                        message=f"Enqueue failed: {exc}",
                    )
                )
        db.commit()

    return TaskCreateOut(
        batch_id=batch.id if batch else None,
        task_ids=[task.id for task in created_tasks],
        total_count=len(created_tasks),
    )


@router.get("", response_model=list[TaskItemOut])
def list_tasks(task_type: str = Query(default="ocr"), db: Session = Depends(get_db)) -> list[TaskItemOut]:
    stmt = select(Task).options(selectinload(Task.prompt), selectinload(Task.result)).order_by(Task.created_at.desc())
    if task_type in {"ocr", "create", "framework"}:
        stmt = stmt.where(Task.task_type == TaskType(task_type))
    tasks = db.execute(stmt).scalars().all()
    return [_task_to_item(t, db) for t in tasks]


@router.post("/download-batch")
def download_tasks_batch(payload: TaskDownloadBatchIn, db: Session = Depends(get_db)) -> Response:
    unique_ids = list(dict.fromkeys(payload.task_ids))
    stmt = select(Task).options(selectinload(Task.result)).where(Task.id.in_(unique_ids))
    task_map = {t.id: t for t in db.execute(stmt).scalars().all()}

    zip_buffer = io.BytesIO()
    used_names: dict[str, int] = {}
    downloaded_tasks: list[Task] = []
    task_types: set[str] = set()

    with zipfile.ZipFile(zip_buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        for task_id in unique_ids:
            task = task_map.get(task_id)
            if not task or not task.result or not (task.result.full_output or "").strip():
                continue
            base_name = _single_download_filename(task)
            count = used_names.get(base_name, 0)
            used_names[base_name] = count + 1
            if count > 0:
                stem = Path(base_name).stem
                ext = Path(base_name).suffix or ".txt"
                file_name = f"{stem}_{count + 1}{ext}"
            else:
                file_name = base_name
            zf.writestr(file_name, task.result.full_output or "")
            downloaded_tasks.append(task)
            task_types.add(task.task_type.value)

    if not downloaded_tasks:
        raise HTTPException(status_code=400, detail="No downloadable tasks with full output.")

    now = datetime.now(timezone.utc)
    for task in downloaded_tasks:
        assert task.result is not None
        task.result.download_count = (task.result.download_count or 0) + 1
        task.result.last_downloaded_at = now
    db.commit()

    zip_buffer.seek(0)
    filename = _zip_download_filename(task_types)
    headers = {"Content-Disposition": _content_disposition_header(filename)}
    return Response(content=zip_buffer.getvalue(), media_type="application/zip", headers=headers)


@router.get("/{task_id}/download")
def download_task(task_id: int, db: Session = Depends(get_db)) -> Response:
    stmt = select(Task).options(selectinload(Task.result)).where(Task.id == task_id)
    task = db.execute(stmt).scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found.")
    if not task.result or not (task.result.full_output or "").strip():
        raise HTTPException(status_code=400, detail="No downloadable output for this task.")

    file_name = _single_download_filename(task)
    now = datetime.now(timezone.utc)
    task.result.download_count = (task.result.download_count or 0) + 1
    task.result.last_downloaded_at = now
    db.commit()

    headers = {"Content-Disposition": _content_disposition_header(file_name)}
    return Response(content=(task.result.full_output or "").encode("utf-8"), media_type="text/plain; charset=utf-8", headers=headers)


@router.get("/{task_id}", response_model=TaskDetailOut)
def get_task(task_id: int, db: Session = Depends(get_db)) -> TaskDetailOut:
    stmt = (
        select(Task)
        .options(selectinload(Task.images), selectinload(Task.result), selectinload(Task.prompt))
        .where(Task.id == task_id)
    )
    task = db.execute(stmt).scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found.")
    book_name = task.book_title_snapshot
    if book_name is None and task.book_id is not None:
        book = db.get(Book, task.book_id)
        book_name = book.title if book else None

    return TaskDetailOut(
        id=task.id,
        task_type=task.task_type.value,
        title=task.title,
        batch_id=task.batch_id,
        folder_name=task.folder_name,
        book_id=task.book_id,
        book_name=book_name,
        prompt_id=task.prompt_id,
        prompt_name=task.prompt.name if task.prompt else None,
        llm_model=task.llm_model,
        download_count=(task.result.download_count if task.result else 0),
        status=task.status.value,
        error_message=task.error_message,
        retry_count=task.retry_count,
        created_at=task.created_at,
        images=[
            TaskImageOut(
                id=image.id,
                file_name=image.file_name,
                sort_index=image.sort_index,
                file_path=image.file_path,
            )
            for image in sorted(task.images, key=lambda i: i.sort_index)
        ],
        original_note_text=task.result.original_note_text if task.result else None,
        matched_book_segments=task.result.matched_book_segments if task.result else None,
        extracted_title=task.result.extracted_title if task.result else None,
        extracted_points_text=task.result.extracted_points_text if task.result else None,
        full_output=task.result.full_output if task.result else None,
    )


@router.patch("/{task_id}/full-output", response_model=TaskDetailOut)
def update_task_full_output(task_id: int, payload: TaskFullOutputUpdateIn, db: Session = Depends(get_db)) -> TaskDetailOut:
    stmt = (
        select(Task)
        .options(selectinload(Task.images), selectinload(Task.result), selectinload(Task.prompt))
        .where(Task.id == task_id)
    )
    task = db.execute(stmt).scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found.")

    result = task.result
    if not result:
        result = TaskResult(task_id=task.id)
        db.add(result)
        db.flush()

    result.full_output = payload.full_output
    db.commit()
    db.refresh(task)
    if task.result:
        db.refresh(task.result)
    book_name = task.book_title_snapshot
    if book_name is None and task.book_id is not None:
        book = db.get(Book, task.book_id)
        book_name = book.title if book else None

    return TaskDetailOut(
        id=task.id,
        task_type=task.task_type.value,
        title=task.title,
        batch_id=task.batch_id,
        folder_name=task.folder_name,
        book_id=task.book_id,
        book_name=book_name,
        prompt_id=task.prompt_id,
        prompt_name=task.prompt.name if task.prompt else None,
        llm_model=task.llm_model,
        download_count=(task.result.download_count if task.result else 0),
        status=task.status.value,
        error_message=task.error_message,
        retry_count=task.retry_count,
        created_at=task.created_at,
        images=[
            TaskImageOut(
                id=image.id,
                file_name=image.file_name,
                sort_index=image.sort_index,
                file_path=image.file_path,
            )
            for image in sorted(task.images, key=lambda i: i.sort_index)
        ],
        original_note_text=task.result.original_note_text if task.result else None,
        matched_book_segments=task.result.matched_book_segments if task.result else None,
        extracted_title=task.result.extracted_title if task.result else None,
        extracted_points_text=task.result.extracted_points_text if task.result else None,
        full_output=task.result.full_output if task.result else None,
    )


@router.post("/{task_id}/retry", response_model=TaskItemOut)
def retry_task(task_id: int, force: bool = Query(default=False), db: Session = Depends(get_db)) -> TaskItemOut:
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found.")
    if task.status == TaskStatus.processing:
        if not force:
            raise HTTPException(
                status_code=409,
                detail="Task is currently processing. Retry with `force=true` to reset and requeue.",
            )

    task.status = TaskStatus.waiting
    task.error_message = None
    task.retry_count += 1
    db.commit()
    db.refresh(task)

    enqueue_task(task.id)
    return _task_to_item(task, db)


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(task_id: int, db: Session = Depends(get_db)) -> Response:
    stmt = select(Task).options(selectinload(Task.images)).where(Task.id == task_id)
    task = db.execute(stmt).scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found.")
    if task.status == TaskStatus.processing:
        raise HTTPException(status_code=409, detail="Task is currently processing and cannot be deleted.")

    batch_id = task.batch_id
    task_root = Path(settings.task_root)
    task_dir = task_root / str(task.id)

    db.delete(task)
    if batch_id is not None:
        _refresh_batch_after_task_change(db, batch_id)
    db.commit()

    if task_dir.exists():
        shutil.rmtree(task_dir, ignore_errors=True)

    return Response(status_code=status.HTTP_204_NO_CONTENT)
