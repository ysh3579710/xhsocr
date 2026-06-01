from datetime import datetime

from pydantic import BaseModel
from app.schemas.tasks import TaskItemOut


class BatchOut(BaseModel):
    id: int
    batch_name: str
    batch_type: str
    total_count: int
    success_count: int
    failed_count: int
    status: str
    created_at: datetime


class BatchListPageOut(BaseModel):
    items: list[BatchOut]
    page: int
    page_size: int
    total: int
    total_pages: int


class BatchTaskListPageOut(BaseModel):
    items: list[TaskItemOut]
    page: int
    page_size: int
    total: int
    total_pages: int
