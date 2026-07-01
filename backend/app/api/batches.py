from datetime import datetime, timedelta, timezone
from math import ceil

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.tasks import _build_tasks_zip_response, _content_disposition_header, _retry_task_in_place, _task_to_item
from app.db.deps import get_db
from app.models.entities import Batch, Task, TaskStatus
from app.schemas.batches import BatchListPageOut, BatchOut, BatchRetryAllOut, BatchTaskListPageOut

router = APIRouter(prefix="/batch", tags=["batch"])


def _to_out(batch: Batch) -> BatchOut:
    return BatchOut(
        id=batch.id,
        batch_name=batch.batch_name,
        batch_type=batch.batch_type.value,
        total_count=batch.total_count,
        success_count=batch.success_count,
        failed_count=batch.failed_count,
        status=batch.status.value,
        download_count=batch.download_count,
        created_at=batch.created_at,
    )


def _sync_or_delete_batch(db: Session, batch: Batch) -> Batch | None:
    tasks = db.execute(select(Task).where(Task.batch_id == batch.id)).scalars().all()
    total = len(tasks)
    if total == 0:
        db.delete(batch)
        db.commit()
        return None

    success_count = sum(1 for t in tasks if t.status == TaskStatus.success)
    failed_count = sum(1 for t in tasks if t.status == TaskStatus.failed)
    processing_count = sum(1 for t in tasks if t.status == TaskStatus.processing)

    changed = False
    if batch.total_count != total:
        batch.total_count = total
        changed = True
    if batch.success_count != success_count:
        batch.success_count = success_count
        changed = True
    if batch.failed_count != failed_count:
        batch.failed_count = failed_count
        changed = True

    expected_status = TaskStatus.waiting
    if success_count + failed_count == total:
        expected_status = TaskStatus.success if failed_count == 0 else TaskStatus.failed
    elif processing_count > 0:
        expected_status = TaskStatus.processing
    if batch.status != expected_status:
        batch.status = expected_status
        changed = True

    if changed:
        db.commit()
        db.refresh(batch)
    return batch


def _batch_zip_filename(batch: Batch) -> str:
    safe_name = "".join(char if char.isalnum() or char in {"-", "_"} else "_" for char in batch.batch_name.strip())
    safe_name = safe_name.strip("._") or "batch"
    sh_tz = timezone(timedelta(hours=8))
    suffix = datetime.now(sh_tz).strftime("%Y%m%d_%H%M%S")
    return f"batch_{batch.id}_{safe_name}_{suffix}.zip"


@router.get("", response_model=BatchListPageOut)
def list_batches(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(get_db),
) -> BatchListPageOut:
    rows = db.execute(select(Batch).order_by(Batch.created_at.desc())).scalars().all()
    out: list[BatchOut] = []
    for row in rows:
        synced = _sync_or_delete_batch(db, row)
        if synced is not None:
            out.append(_to_out(synced))
    total = len(out)
    total_pages = max(1, ceil(total / page_size)) if page_size > 0 else 1
    start = (page - 1) * page_size
    end = start + page_size
    return BatchListPageOut(items=out[start:end], page=page, page_size=page_size, total=total, total_pages=total_pages)


@router.get("/{batch_id}", response_model=BatchOut)
def get_batch(batch_id: int, db: Session = Depends(get_db)) -> BatchOut:
    batch = db.get(Batch, batch_id)
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found.")
    synced = _sync_or_delete_batch(db, batch)
    if not synced:
        raise HTTPException(status_code=404, detail="Batch not found.")
    return _to_out(synced)


@router.get("/{batch_id}/tasks", response_model=BatchTaskListPageOut)
def get_batch_tasks(
    batch_id: int,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(get_db),
) -> BatchTaskListPageOut:
    batch = db.get(Batch, batch_id)
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found.")
    synced = _sync_or_delete_batch(db, batch)
    if not synced:
        raise HTTPException(status_code=404, detail="Batch not found.")

    tasks = db.execute(
        select(Task)
        .options(selectinload(Task.prompt), selectinload(Task.result))
        .where(Task.batch_id == batch_id)
        .order_by(Task.created_at.desc())
    ).scalars().all()
    total = len(tasks)
    total_pages = max(1, ceil(total / page_size)) if page_size > 0 else 1
    start = (page - 1) * page_size
    end = start + page_size
    page_items = [_task_to_item(task, db) for task in tasks[start:end]]
    return BatchTaskListPageOut(items=page_items, page=page, page_size=page_size, total=total, total_pages=total_pages)


@router.post("/{batch_id}/download")
def download_batch_tasks(batch_id: int, db: Session = Depends(get_db)) -> Response:
    batch = db.get(Batch, batch_id)
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found.")
    synced = _sync_or_delete_batch(db, batch)
    if not synced:
        raise HTTPException(status_code=404, detail="Batch not found.")
    if synced.status in {TaskStatus.waiting, TaskStatus.processing}:
        raise HTTPException(status_code=400, detail="当前批次仍有进行中的任务，暂不支持下载。")

    tasks = db.execute(
        select(Task)
        .options(selectinload(Task.result))
        .where(Task.batch_id == batch_id)
        .order_by(Task.created_at.desc())
    ).scalars().all()
    response = _build_tasks_zip_response(
        tasks,
        empty_detail="当前批次没有可下载的任务内容。",
        file_name=_batch_zip_filename(synced),
        db=db,
    )
    synced.download_count = (synced.download_count or 0) + 1
    synced.last_downloaded_at = datetime.now(timezone.utc)
    db.commit()
    return response


@router.post("/{batch_id}/retry-all", response_model=BatchRetryAllOut)
def retry_all_batch_tasks(batch_id: int, db: Session = Depends(get_db)) -> BatchRetryAllOut:
    batch = db.get(Batch, batch_id)
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found.")
    synced = _sync_or_delete_batch(db, batch)
    if not synced:
        raise HTTPException(status_code=404, detail="Batch not found.")

    tasks = db.execute(
        select(Task)
        .options(selectinload(Task.result))
        .where(Task.batch_id == batch_id)
        .order_by(Task.created_at.desc())
    ).scalars().all()
    if any(task.status in {TaskStatus.waiting, TaskStatus.processing} for task in tasks):
        raise HTTPException(status_code=400, detail="当前批次仍有进行中的任务，暂不支持全部重试。")

    retried_count = 0
    for task in tasks:
        _retry_task_in_place(task, db)
        retried_count += 1

    synced.status = TaskStatus.processing
    db.commit()
    return BatchRetryAllOut(batch_id=batch_id, retried_count=retried_count)


@router.post("/{batch_id}/retry-failed", response_model=BatchRetryAllOut)
def retry_failed_batch_tasks(batch_id: int, db: Session = Depends(get_db)) -> BatchRetryAllOut:
    batch = db.get(Batch, batch_id)
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found.")
    synced = _sync_or_delete_batch(db, batch)
    if not synced:
        raise HTTPException(status_code=404, detail="Batch not found.")

    tasks = db.execute(
        select(Task)
        .options(selectinload(Task.result))
        .where(Task.batch_id == batch_id)
        .order_by(Task.created_at.desc())
    ).scalars().all()
    if any(task.status in {TaskStatus.waiting, TaskStatus.processing} for task in tasks):
        raise HTTPException(status_code=400, detail="当前批次仍有进行中的任务，暂不支持重写。")

    retried_count = 0
    for task in tasks:
        if task.status != TaskStatus.failed:
            continue
        _retry_task_in_place(task, db)
        retried_count += 1

    synced.status = TaskStatus.processing
    db.commit()
    return BatchRetryAllOut(batch_id=batch_id, retried_count=retried_count)
