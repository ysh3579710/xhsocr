from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class TagCreate(BaseModel):
    tag_text: str = Field(min_length=1, max_length=64)
    enabled: bool = True


class TagUpdate(BaseModel):
    tag_text: Optional[str] = Field(default=None, min_length=1, max_length=64)
    enabled: Optional[bool] = None


class TagOut(BaseModel):
    id: int
    tag_text: str
    enabled: bool
    created_at: datetime
    updated_at: datetime


class FixedTagsUpdate(BaseModel):
    fixed_tags: list[str] = Field(min_length=5, max_length=5)


class FixedTagsOut(BaseModel):
    fixed_tags: list[str]
