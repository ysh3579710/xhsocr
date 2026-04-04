from __future__ import annotations

import enum
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class TaskStatus(str, enum.Enum):
    waiting = "waiting"
    processing = "processing"
    success = "success"
    failed = "failed"


class TaskType(str, enum.Enum):
    ocr = "ocr"
    create = "create"
    framework = "framework"


class BatchType(str, enum.Enum):
    ocr = "ocr"
    create = "create"
    framework = "framework"


class Book(Base):
    __tablename__ = "books"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    author: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    file_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    segments = relationship("BookSegment", back_populates="book", cascade="all, delete-orphan")


class BookSegment(Base):
    __tablename__ = "book_segments"
    __table_args__ = (Index("ix_book_segments_book_id_segment_index", "book_id", "segment_index"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    book_id: Mapped[int] = mapped_column(ForeignKey("books.id", ondelete="CASCADE"), nullable=False)
    segment_index: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    book = relationship("Book", back_populates="segments")


class TagLibrary(Base):
    __tablename__ = "tag_library"

    id: Mapped[int] = mapped_column(primary_key=True)
    tag_text: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)


class AppSetting(Base):
    __tablename__ = "app_settings"

    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    value: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)


class Prompt(Base):
    __tablename__ = "prompts"
    __table_args__ = (
        UniqueConstraint("track", "name", name="uq_prompts_track_name"),
        Index("ix_prompts_track", "track"),
        Index("ix_prompts_enabled", "enabled"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    track: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    tasks = relationship("Task", back_populates="prompt")


class Batch(Base):
    __tablename__ = "batches"

    id: Mapped[int] = mapped_column(primary_key=True)
    batch_name: Mapped[str] = mapped_column(String(255), nullable=False)
    batch_type: Mapped[BatchType] = mapped_column(Enum(BatchType, name="batch_type"), nullable=False, default=BatchType.ocr)
    total_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    success_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    failed_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[TaskStatus] = mapped_column(Enum(TaskStatus, name="task_status"), nullable=False, default=TaskStatus.waiting)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    tasks = relationship("Task", back_populates="batch")


class Task(Base):
    __tablename__ = "tasks"
    __table_args__ = (
        Index("ix_tasks_batch_id", "batch_id"),
        Index("ix_tasks_status_created_at", "status", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    task_type: Mapped[TaskType] = mapped_column(Enum(TaskType, name="task_type"), nullable=False, default=TaskType.ocr)
    title: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    batch_id: Mapped[Optional[int]] = mapped_column(ForeignKey("batches.id", ondelete="SET NULL"), nullable=True)
    folder_name: Mapped[str] = mapped_column(String(255), nullable=False)
    book_id: Mapped[Optional[int]] = mapped_column(ForeignKey("books.id", ondelete="RESTRICT"), nullable=True)
    book_title_snapshot: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    prompt_id: Mapped[Optional[int]] = mapped_column(ForeignKey("prompts.id", ondelete="SET NULL"), nullable=True)
    prompt_snapshot: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    llm_model: Mapped[str] = mapped_column(String(128), nullable=False, default="openai/gpt-5-mini")
    status: Mapped[TaskStatus] = mapped_column(Enum(TaskStatus, name="task_status"), nullable=False, default=TaskStatus.waiting)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    retry_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    batch = relationship("Batch", back_populates="tasks")
    prompt = relationship("Prompt", back_populates="tasks")
    images = relationship("TaskImage", back_populates="task", cascade="all, delete-orphan")
    result = relationship("TaskResult", back_populates="task", uselist=False, cascade="all, delete-orphan")
    logs = relationship("TaskLog", back_populates="task", cascade="all, delete-orphan")


class TaskImage(Base):
    __tablename__ = "task_images"
    __table_args__ = (Index("ix_task_images_task_id_sort_index", "task_id", "sort_index"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    sort_index: Mapped[int] = mapped_column(Integer, nullable=False)
    file_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    task = relationship("Task", back_populates="images")


class TaskResult(Base):
    __tablename__ = "task_results"

    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True)
    original_note_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    matched_book_segments: Mapped[Optional[dict[str, Any]]] = mapped_column(JSONB, nullable=True)
    extracted_title: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    extracted_points_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    rewritten_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    intro_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    fixed_tags_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    random_tags_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    full_output: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    download_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_downloaded_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    task = relationship("Task", back_populates="result")


class TaskLog(Base):
    __tablename__ = "task_logs"
    __table_args__ = (Index("ix_task_logs_task_id_created_at", "task_id", "created_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False)
    stage: Mapped[str] = mapped_column(String(64), nullable=False)
    level: Mapped[str] = mapped_column(String(16), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    task = relationship("Task", back_populates="logs")
