from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class BookOut(BaseModel):
    id: int
    title: str
    author: Optional[str]
    file_path: str
    segment_count: int
    created_at: datetime


class BookUploadOut(BookOut):
    pass
