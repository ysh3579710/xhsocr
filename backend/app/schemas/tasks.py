from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class TaskBindingIn(BaseModel):
    folder_name: str
    book_id: int


class TaskCreateOut(BaseModel):
    batch_id: Optional[int]
    task_ids: list[int]
    total_count: int


class TaskItemOut(BaseModel):
    id: int
    batch_id: Optional[int]
    folder_name: str
    book_id: int
    status: str
    error_message: Optional[str]
    retry_count: int
    created_at: datetime


class TaskImageOut(BaseModel):
    id: int
    file_name: str
    sort_index: int
    file_path: str


class TaskDetailOut(TaskItemOut):
    images: list[TaskImageOut]
    original_note_text: Optional[str] = None
    matched_book_segments: Optional[dict] = None
    rewritten_note: Optional[str] = None
    intro_text: Optional[str] = None
    fixed_tags_text: Optional[str] = None
    random_tags_text: Optional[str] = None
    full_output: Optional[str] = None
