from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.deps import get_db
from app.models.entities import Book, FeaturedNote, Prompt, Task, TaskResult, TaskStatus, TaskType
from app.schemas.featured_notes import (
    FeaturedNoteCreateSpawnIn,
    FeaturedNoteFrameworkSpawnIn,
    FeaturedNoteManualIn,
    FeaturedNoteOut,
    FeaturedNoteRewriteSpawnIn,
    FeaturedNoteUpdateIn,
)
from app.schemas.tasks import TaskCreateOut
from app.services.task_queue import enqueue_task

router = APIRouter(prefix="/featured-notes", tags=["featured-notes"])


def _parse_manual_content(content: str) -> tuple[str, str]:
    normalized = content.replace("\r\n", "\n").replace("\r", "\n").strip()
    if not normalized:
        raise HTTPException(status_code=400, detail="内容不能为空。")
    first_line = normalized.split("\n", 1)[0].strip()
    if not first_line:
        raise HTTPException(status_code=400, detail="第一行标题不能为空。")
    return first_line[:255], normalized


def _to_out(note: FeaturedNote) -> FeaturedNoteOut:
    return FeaturedNoteOut(
        id=note.id,
        source_task_type=note.source_task_type,
        source_task_id=note.source_task_id,
        title=note.title,
        full_text=note.full_text,
        is_manual=note.is_manual,
        structured_title=note.structured_title,
        structured_points_text=note.structured_points_text,
        structured_outline=note.structured_outline,
        created_at=note.created_at,
        updated_at=note.updated_at,
    )


def _get_prompt_or_400(db: Session, prompt_id: int) -> Prompt:
    prompt = db.get(Prompt, prompt_id)
    if not prompt:
        raise HTTPException(status_code=400, detail="prompt_id not found.")
    if not prompt.enabled:
        raise HTTPException(status_code=400, detail="Prompt is disabled and cannot be selected.")
    return prompt


def _get_book_title_or_400(db: Session, book_id: int) -> str:
    book = db.get(Book, book_id)
    if not book:
        raise HTTPException(status_code=400, detail="book_id not found.")
    return book.title


def _enqueue_if_needed(db: Session, task: Task, auto_enqueue: bool) -> None:
    if not auto_enqueue:
        return
    try:
        enqueue_task(task.id)
    except Exception as exc:
        task.error_message = f"Enqueue failed: {exc}"
        db.commit()
        raise HTTPException(status_code=500, detail=f"Enqueue failed: {exc}") from exc


@router.get("", response_model=list[FeaturedNoteOut])
def list_featured_notes(db: Session = Depends(get_db)) -> list[FeaturedNoteOut]:
    rows = db.execute(select(FeaturedNote).order_by(FeaturedNote.updated_at.desc(), FeaturedNote.id.desc())).scalars().all()
    return [_to_out(row) for row in rows]


@router.post("/manual", response_model=FeaturedNoteOut, status_code=status.HTTP_201_CREATED)
def create_manual_featured_note(payload: FeaturedNoteManualIn, db: Session = Depends(get_db)) -> FeaturedNoteOut:
    title, full_text = _parse_manual_content(payload.content)
    note = FeaturedNote(
        title=title,
        full_text=full_text,
        is_manual=True,
    )
    db.add(note)
    db.commit()
    db.refresh(note)
    return _to_out(note)


@router.get("/{note_id}", response_model=FeaturedNoteOut)
def get_featured_note(note_id: int, db: Session = Depends(get_db)) -> FeaturedNoteOut:
    note = db.get(FeaturedNote, note_id)
    if not note:
        raise HTTPException(status_code=404, detail="精选笔记不存在。")
    return _to_out(note)


@router.put("/{note_id}", response_model=FeaturedNoteOut)
def update_featured_note(note_id: int, payload: FeaturedNoteUpdateIn, db: Session = Depends(get_db)) -> FeaturedNoteOut:
    note = db.get(FeaturedNote, note_id)
    if not note:
        raise HTTPException(status_code=404, detail="精选笔记不存在。")
    title, full_text = _parse_manual_content(payload.content)
    note.title = title
    note.full_text = full_text
    db.commit()
    db.refresh(note)
    return _to_out(note)


@router.delete("/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_featured_note(note_id: int, db: Session = Depends(get_db)) -> Response:
    note = db.get(FeaturedNote, note_id)
    if not note:
        raise HTTPException(status_code=404, detail="精选笔记不存在。")
    db.delete(note)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{note_id}/spawn-rewrite", response_model=TaskCreateOut, status_code=status.HTTP_201_CREATED)
def spawn_rewrite_from_featured(note_id: int, payload: FeaturedNoteRewriteSpawnIn, db: Session = Depends(get_db)) -> TaskCreateOut:
    note = db.get(FeaturedNote, note_id)
    if not note:
        raise HTTPException(status_code=404, detail="精选笔记不存在。")
    prompt = _get_prompt_or_400(db, payload.prompt_id)
    book_title = _get_book_title_or_400(db, payload.book_id)

    task = Task(
        task_type=TaskType.ocr,
        folder_name=payload.task_name.strip(),
        book_id=payload.book_id,
        book_title_snapshot=book_title,
        prompt_id=prompt.id,
        prompt_snapshot=prompt.content,
        status=TaskStatus.waiting,
    )
    db.add(task)
    db.flush()
    db.add(
        TaskResult(
            task_id=task.id,
            original_note_text=note.full_text,
        )
    )
    db.commit()
    db.refresh(task)
    _enqueue_if_needed(db, task, payload.auto_enqueue)
    return TaskCreateOut(batch_id=None, task_ids=[task.id], total_count=1)


@router.post("/{note_id}/spawn-create", response_model=TaskCreateOut, status_code=status.HTTP_201_CREATED)
def spawn_create_from_featured(note_id: int, payload: FeaturedNoteCreateSpawnIn, db: Session = Depends(get_db)) -> TaskCreateOut:
    note = db.get(FeaturedNote, note_id)
    if not note:
        raise HTTPException(status_code=404, detail="精选笔记不存在。")
    prompt = _get_prompt_or_400(db, payload.prompt_id)
    book_title = None
    if payload.book_id is not None:
        book_title = _get_book_title_or_400(db, payload.book_id)

    title = payload.title.strip()
    task = Task(
        task_type=TaskType.create,
        title=title,
        folder_name=title,
        book_id=payload.book_id,
        book_title_snapshot=book_title,
        prompt_id=prompt.id,
        prompt_snapshot=prompt.content,
        status=TaskStatus.waiting,
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    _enqueue_if_needed(db, task, payload.auto_enqueue)
    return TaskCreateOut(batch_id=None, task_ids=[task.id], total_count=1)


@router.post("/{note_id}/spawn-framework", response_model=TaskCreateOut, status_code=status.HTTP_201_CREATED)
def spawn_framework_from_featured(note_id: int, payload: FeaturedNoteFrameworkSpawnIn, db: Session = Depends(get_db)) -> TaskCreateOut:
    note = db.get(FeaturedNote, note_id)
    if not note:
        raise HTTPException(status_code=404, detail="精选笔记不存在。")
    prompt = _get_prompt_or_400(db, payload.prompt_id)
    book_title = _get_book_title_or_400(db, payload.book_id)

    task = Task(
        task_type=TaskType.framework,
        title=note.structured_title or note.title,
        folder_name=payload.task_name.strip(),
        book_id=payload.book_id,
        book_title_snapshot=book_title,
        prompt_id=prompt.id,
        prompt_snapshot=prompt.content,
        status=TaskStatus.waiting,
    )
    db.add(task)
    db.flush()
    db.add(
        TaskResult(
            task_id=task.id,
            original_note_text=note.full_text,
            extracted_title=note.structured_title,
            extracted_points_text=note.structured_points_text,
            matched_book_segments=({"outline": note.structured_outline} if note.structured_outline else None),
        )
    )
    db.commit()
    db.refresh(task)
    _enqueue_if_needed(db, task, payload.auto_enqueue)
    return TaskCreateOut(batch_id=None, task_ids=[task.id], total_count=1)
