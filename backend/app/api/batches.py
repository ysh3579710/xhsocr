from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.deps import get_db
from app.models.entities import Batch, Task, TaskStatus
from app.schemas.batches import BatchOut

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


@router.get("", response_model=list[BatchOut])
def list_batches(db: Session = Depends(get_db)) -> list[BatchOut]:
    rows = db.execute(select(Batch).order_by(Batch.created_at.desc())).scalars().all()
    out: list[BatchOut] = []
    for row in rows:
        synced = _sync_or_delete_batch(db, row)
        if synced is not None:
            out.append(_to_out(synced))
    return out


@router.get("/{batch_id}", response_model=BatchOut)
def get_batch(batch_id: int, db: Session = Depends(get_db)) -> BatchOut:
    batch = db.get(Batch, batch_id)
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found.")
    synced = _sync_or_delete_batch(db, batch)
    if not synced:
        raise HTTPException(status_code=404, detail="Batch not found.")
    return _to_out(synced)
