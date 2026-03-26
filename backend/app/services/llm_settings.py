from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.entities import AppSetting

LLM_MODEL_KEY = "active_llm_model"
SUPPORTED_LLM_MODELS = [
    "openai/gpt-5-mini",
    "openai/gpt-5.3-chat",
    "claude-sonnet-4.6",
]


def list_supported_llm_models() -> list[str]:
    return SUPPORTED_LLM_MODELS.copy()


def get_active_llm_model(db: Session) -> str:
    row = db.execute(select(AppSetting).where(AppSetting.key == LLM_MODEL_KEY)).scalar_one_or_none()
    if not row:
        return settings.openrouter_model
    value = (row.value or "").strip()
    if value in SUPPORTED_LLM_MODELS:
        return value
    return settings.openrouter_model


def set_active_llm_model(db: Session, model: str) -> str:
    model_name = (model or "").strip()
    if model_name not in SUPPORTED_LLM_MODELS:
        raise ValueError(f"Unsupported model: {model_name}")

    row = db.execute(select(AppSetting).where(AppSetting.key == LLM_MODEL_KEY)).scalar_one_or_none()
    if row:
        row.value = model_name
    else:
        db.add(AppSetting(key=LLM_MODEL_KEY, value=model_name))
    db.commit()
    return model_name
