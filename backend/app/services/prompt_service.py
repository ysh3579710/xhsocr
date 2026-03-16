from __future__ import annotations

from typing import Optional

from sqlalchemy import and_, func, select, update
from sqlalchemy.orm import Session

from app.models.entities import PromptTemplate, PromptType, PromptVersion


def parse_prompt_type(value: str) -> PromptType:
    try:
        return PromptType(value)
    except Exception as exc:
        raise ValueError(f"Invalid prompt_type: {value}") from exc


def get_active_version(db: Session, prompt_type: PromptType) -> Optional[PromptVersion]:
    stmt = (
        select(PromptVersion)
        .join(PromptTemplate, PromptTemplate.id == PromptVersion.template_id)
        .where(and_(PromptTemplate.prompt_type == prompt_type, PromptVersion.is_active.is_(True)))
        .order_by(PromptVersion.created_at.desc())
        .limit(1)
    )
    return db.execute(stmt).scalar_one_or_none()


def create_template(db: Session, prompt_type: PromptType, name: str) -> PromptTemplate:
    tpl = PromptTemplate(prompt_type=prompt_type, name=name.strip())
    db.add(tpl)
    db.commit()
    db.refresh(tpl)
    return tpl


def create_version(db: Session, template_id: int, content: str, activate: bool = False) -> PromptVersion:
    max_no_stmt = select(func.max(PromptVersion.version_no)).where(PromptVersion.template_id == template_id)
    max_no = db.execute(max_no_stmt).scalar_one_or_none() or 0
    version = PromptVersion(
        template_id=template_id,
        version_no=int(max_no) + 1,
        content=content,
        is_active=False,
    )
    db.add(version)
    db.flush()

    if activate:
        activate_version(db, template_id, version.id)
    else:
        db.commit()
    db.refresh(version)
    return version


def activate_version(db: Session, template_id: int, version_id: int) -> None:
    db.execute(
        update(PromptVersion)
        .where(PromptVersion.template_id == template_id)
        .values(is_active=False)
    )
    db.execute(
        update(PromptVersion)
        .where(and_(PromptVersion.template_id == template_id, PromptVersion.id == version_id))
        .values(is_active=True)
    )
    db.commit()
