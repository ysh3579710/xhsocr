from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.config import settings
from app.db.deps import get_db
from app.models.entities import Batch, Book, Task, TaskImage, TaskLog, TaskStatus
from app.schemas.tasks import TaskBindingIn, TaskCreateOut, TaskDetailOut, TaskImageOut, TaskItemOut
from app.services.task_queue import enqueue_task
from app.utils.sort import natural_sort_key

router = APIRouter(prefix="/tasks", tags=["tasks"])

ALLOWED_IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp"}
IGNORED_FILE_NAMES = {"Thumbs.db", "desktop.ini"}


def _task_to_item(task: Task) -> TaskItemOut:
    return TaskItemOut(
        id=task.id,
        batch_id=task.batch_id,
        folder_name=task.folder_name,
        book_id=task.book_id,
        llm_model=task.llm_model,
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
            batch_id=batch.id if batch else None,
            folder_name=folder_name,
            book_id=book_id,
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


@router.get("", response_model=list[TaskItemOut])
def list_tasks(db: Session = Depends(get_db)) -> list[TaskItemOut]:
    stmt = select(Task).order_by(Task.created_at.desc())
    tasks = db.execute(stmt).scalars().all()
    return [_task_to_item(t) for t in tasks]


@router.get("/{task_id}", response_model=TaskDetailOut)
def get_task(task_id: int, db: Session = Depends(get_db)) -> TaskDetailOut:
    stmt = select(Task).options(selectinload(Task.images), selectinload(Task.result)).where(Task.id == task_id)
    task = db.execute(stmt).scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found.")

    return TaskDetailOut(
        id=task.id,
        batch_id=task.batch_id,
        folder_name=task.folder_name,
        book_id=task.book_id,
        llm_model=task.llm_model,
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
        rewritten_note=task.result.rewritten_note if task.result else None,
        intro_text=task.result.intro_text if task.result else None,
        fixed_tags_text=task.result.fixed_tags_text if task.result else None,
        random_tags_text=task.result.random_tags_text if task.result else None,
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
    return _task_to_item(task)


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
