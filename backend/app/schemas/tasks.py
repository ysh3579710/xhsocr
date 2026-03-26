from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class TaskBindingIn(BaseModel):
    folder_name: str
    book_id: int


class TaskCreateOut(BaseModel):
    batch_id: Optional[int]
    task_ids: list[int]
    total_count: int


class CreateTaskBatchIn(BaseModel):
    titles: list[str] = Field(min_length=1)
    book_id: Optional[int] = None
    batch_name: Optional[str] = "batch"
    auto_enqueue: bool = True


class TaskItemOut(BaseModel):
    id: int
    task_type: str
    title: Optional[str]
    batch_id: Optional[int]
    folder_name: str
    book_id: Optional[int]
    llm_model: str
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
