from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class PromptCreateIn(BaseModel):
    track: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=128)
    content: str = Field(min_length=1)
    enabled: bool = True


class PromptUpdateIn(BaseModel):
    track: Optional[str] = Field(default=None, min_length=1, max_length=64)
    name: Optional[str] = Field(default=None, min_length=1, max_length=128)
    content: Optional[str] = Field(default=None, min_length=1)
    enabled: Optional[bool] = None


class PromptOut(BaseModel):
    id: int
    track: str
    name: str
    content: str
    enabled: bool
    created_at: datetime
    updated_at: datetime


class LLMModelUpdate(BaseModel):
    active_model: str = Field(min_length=1)


class LLMModelConfigOut(BaseModel):
    active_model: str
    supported_models: list[str]

