from __future__ import annotations

from pathlib import Path
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.deps import get_db
from app.models.entities import Book, BookSegment, Task
from app.schemas.books import BookOut, BookUploadOut
from app.services.book_parser import parse_docx_text, segment_book

router = APIRouter(prefix="/books", tags=["books"])


def _book_to_out(book: Book, segment_count: int) -> BookOut:
    return BookOut(
        id=book.id,
        title=book.title,
        author=book.author,
        file_path=book.file_path,
        segment_count=segment_count,
        created_at=book.created_at,
    )


@router.post("/upload", response_model=BookUploadOut, status_code=status.HTTP_201_CREATED)
def upload_book(
    file: UploadFile = File(...),
    title: Optional[str] = Form(default=None),
    author: Optional[str] = Form(default=None),
    db: Session = Depends(get_db),
) -> BookUploadOut:
    suffix = Path(file.filename or "").suffix.lower()
    if suffix != ".docx":
        raise HTTPException(status_code=400, detail="Only .docx is supported.")

    root = Path(settings.book_root)
    root.mkdir(parents=True, exist_ok=True)
    saved_name = f"{uuid4().hex}{suffix}"
    saved_path = root / saved_name

    content = file.file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    saved_path.write_bytes(content)

    entries = parse_docx_text(str(saved_path))
    segments = segment_book(entries)

    book = Book(
        title=(title or Path(file.filename or "untitled").stem).strip() or "untitled",
        author=author.strip() if author else None,
        file_path=str(saved_path),
    )
    db.add(book)
    db.flush()

    for idx, seg in enumerate(segments, start=1):
        db.add(BookSegment(book_id=book.id, segment_index=idx, content=seg))

    db.commit()
    db.refresh(book)
    return BookUploadOut(
        id=book.id,
        title=book.title,
        author=book.author,
        file_path=book.file_path,
        segment_count=len(segments),
        created_at=book.created_at,
    )


@router.get("", response_model=list[BookOut])
def list_books(db: Session = Depends(get_db)) -> list[BookOut]:
    stmt = (
        select(Book, func.count(BookSegment.id).label("segment_count"))
        .outerjoin(BookSegment, BookSegment.book_id == Book.id)
        .group_by(Book.id)
        .order_by(Book.created_at.desc())
    )
    rows = db.execute(stmt).all()
    return [_book_to_out(book, int(segment_count)) for book, segment_count in rows]


@router.delete("/{book_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_book(book_id: int, db: Session = Depends(get_db)) -> Response:
    book = db.get(Book, book_id)
    if not book:
        raise HTTPException(status_code=404, detail="Book not found.")

    linked_task_ids = db.execute(
        select(Task.id).where(Task.book_id == book_id).order_by(Task.id.asc())
    ).scalars().all()
    linked_task_count = len(linked_task_ids)
    if linked_task_count > 0:
        preview = ", ".join([f"#{tid}" for tid in linked_task_ids[:10]])
        if linked_task_count > 10:
            preview = f"{preview} 等{linked_task_count}个任务"
        raise HTTPException(
            status_code=409,
            detail=f"请先删除关联任务：{preview}",
        )

    file_path = Path(book.file_path)
    db.delete(book)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="请先删除关联任务后再删除书稿。",
        )

    if file_path.exists():
        file_path.unlink()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
