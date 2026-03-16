from __future__ import annotations

import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import AppSetting

FIXED_TAGS_KEY = "fixed_tags"
DEFAULT_FIXED_TAGS = [
    "新手班主任干货",
    "班级管理",
    "提升教学质量",
    "教师干货",
    "班级成绩提升",
]


def _normalize_tag_text(tag: str) -> str:
    return tag.strip().lstrip("#")


def get_fixed_tags(db: Session) -> list[str]:
    row = db.execute(select(AppSetting).where(AppSetting.key == FIXED_TAGS_KEY)).scalar_one_or_none()
    if not row:
        return DEFAULT_FIXED_TAGS.copy()
    try:
        parsed = json.loads(row.value)
    except Exception:
        return DEFAULT_FIXED_TAGS.copy()
    if not isinstance(parsed, list):
        return DEFAULT_FIXED_TAGS.copy()
    tags = [_normalize_tag_text(str(item)) for item in parsed if str(item).strip()]
    if len(tags) != 5:
        return DEFAULT_FIXED_TAGS.copy()
    return tags


def set_fixed_tags(db: Session, tags: list[str]) -> list[str]:
    normalized = [_normalize_tag_text(t) for t in tags if t and _normalize_tag_text(t)]
    if len(normalized) != 5:
        raise ValueError("fixed_tags must contain exactly 5 non-empty tags.")

    row = db.execute(select(AppSetting).where(AppSetting.key == FIXED_TAGS_KEY)).scalar_one_or_none()
    payload = json.dumps(normalized, ensure_ascii=False)
    if row:
        row.value = payload
    else:
        row = AppSetting(key=FIXED_TAGS_KEY, value=payload)
        db.add(row)
    db.commit()
    return normalized
