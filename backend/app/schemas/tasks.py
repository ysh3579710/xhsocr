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
    prompt_id: int
    batch_name: Optional[str] = "batch"
    auto_enqueue: bool = True


class FrameworkCustomTaskIn(BaseModel):
    task_name: str = Field(min_length=1)
    title: str = Field(min_length=1)
    points_text: str = Field(min_length=1)
    book_id: int
    prompt_id: int


class FrameworkCustomBatchIn(BaseModel):
    tasks: list[FrameworkCustomTaskIn] = Field(min_length=1)
    batch_name: Optional[str] = "batch"
    auto_enqueue: bool = True


class TaskItemOut(BaseModel):
    id: int
    task_type: str
    title: Optional[str]
    batch_id: Optional[int]
    folder_name: str
    book_id: Optional[int]
    book_name: Optional[str]
    prompt_id: Optional[int]
    prompt_name: Optional[str]
    llm_model: str
    download_count: int = 0
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
    extracted_title: Optional[str] = None
    extracted_points_text: Optional[str] = None
    full_output: Optional[str] = None


class TaskFullOutputUpdateIn(BaseModel):
    full_output: str


class TaskDownloadBatchIn(BaseModel):
    task_ids: list[int] = Field(min_length=1)
