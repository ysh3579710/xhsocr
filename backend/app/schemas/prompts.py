from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class PromptTemplateCreate(BaseModel):
    prompt_type: str = Field(pattern="^(rewrite|intro|tag|fusion)$")
    name: str = Field(min_length=1, max_length=128)


class PromptTemplateOut(BaseModel):
    id: int
    prompt_type: str
    name: str
    active_version_id: Optional[int] = None
    active_version_no: Optional[int] = None
    created_at: datetime


class PromptVersionCreate(BaseModel):
    content: str = Field(min_length=1)
    activate: bool = False


class PromptVersionUpdate(BaseModel):
    content: str = Field(min_length=1)


class PromptVersionOut(BaseModel):
    id: int
    template_id: int
    version_no: int
    content: str
    is_active: bool
    created_at: datetime


class PromptActivateIn(BaseModel):
    version_id: int
