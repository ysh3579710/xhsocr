from datetime import datetime

from pydantic import BaseModel


class BatchOut(BaseModel):
    id: int
    batch_name: str
    total_count: int
    success_count: int
    failed_count: int
    status: str
    created_at: datetime
