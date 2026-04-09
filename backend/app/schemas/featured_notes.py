from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class FeaturedNoteManualIn(BaseModel):
    content: str = Field(min_length=1)


class FeaturedNoteUpdateIn(BaseModel):
    content: str = Field(min_length=1)


class FeaturedNoteRewriteSpawnIn(BaseModel):
    task_name: str = Field(min_length=1)
    book_id: int
    prompt_id: int
    auto_enqueue: bool = True


class FeaturedNoteCreateSpawnIn(BaseModel):
    title: str = Field(min_length=1)
    book_id: Optional[int] = None
    prompt_id: int
    auto_enqueue: bool = True


class FeaturedNoteFrameworkSpawnIn(BaseModel):
    task_name: str = Field(min_length=1)
    book_id: int
    prompt_id: int
    auto_enqueue: bool = True


class FeaturedNoteOut(BaseModel):
    id: int
    source_task_type: Optional[str]
    source_task_id: Optional[int]
    title: str
    full_text: str
    is_manual: bool
    structured_title: Optional[str]
    structured_points_text: Optional[str]
    structured_outline: Optional[str]
    created_at: datetime
    updated_at: datetime
