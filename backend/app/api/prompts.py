from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import and_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.deps import get_db
from app.models.entities import PromptTemplate, PromptVersion
from app.schemas.prompts import (
    PromptActivateIn,
    PromptTemplateCreate,
    PromptTemplateOut,
    PromptVersionCreate,
    PromptVersionUpdate,
    PromptVersionOut,
)
from app.services.prompt_service import activate_version, create_template, create_version, parse_prompt_type

router = APIRouter(prefix="/prompts", tags=["prompts"])


def _template_out(db: Session, tpl: PromptTemplate) -> PromptTemplateOut:
    active = db.execute(
        select(PromptVersion)
        .where(and_(PromptVersion.template_id == tpl.id, PromptVersion.is_active.is_(True)))
        .order_by(PromptVersion.created_at.desc())
        .limit(1)
    ).scalar_one_or_none()
    return PromptTemplateOut(
        id=tpl.id,
        prompt_type=tpl.prompt_type.value,
        name=tpl.name,
        active_version_id=active.id if active else None,
        active_version_no=active.version_no if active else None,
        created_at=tpl.created_at,
    )


@router.post("/templates", response_model=PromptTemplateOut, status_code=status.HTTP_201_CREATED)
def create_prompt_template(payload: PromptTemplateCreate, db: Session = Depends(get_db)) -> PromptTemplateOut:
    prompt_type = parse_prompt_type(payload.prompt_type)
    try:
        tpl = create_template(db, prompt_type=prompt_type, name=payload.name)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Prompt template already exists.")
    return _template_out(db, tpl)


@router.get("/templates", response_model=list[PromptTemplateOut])
def list_prompt_templates(db: Session = Depends(get_db)) -> list[PromptTemplateOut]:
    templates = db.execute(select(PromptTemplate).order_by(PromptTemplate.created_at.desc())).scalars().all()
    return [_template_out(db, tpl) for tpl in templates]


@router.post(
    "/templates/{template_id}/versions",
    response_model=PromptVersionOut,
    status_code=status.HTTP_201_CREATED,
)
def create_prompt_version(
    template_id: int,
    payload: PromptVersionCreate,
    db: Session = Depends(get_db),
) -> PromptVersionOut:
    tpl = db.get(PromptTemplate, template_id)
    if not tpl:
        raise HTTPException(status_code=404, detail="Prompt template not found.")
    ver = create_version(db, template_id=template_id, content=payload.content, activate=payload.activate)
    return PromptVersionOut(
        id=ver.id,
        template_id=ver.template_id,
        version_no=ver.version_no,
        content=ver.content,
        is_active=ver.is_active,
        created_at=ver.created_at,
    )


@router.get("/templates/{template_id}/versions", response_model=list[PromptVersionOut])
def list_prompt_versions(template_id: int, db: Session = Depends(get_db)) -> list[PromptVersionOut]:
    tpl = db.get(PromptTemplate, template_id)
    if not tpl:
        raise HTTPException(status_code=404, detail="Prompt template not found.")
    rows = (
        db.execute(select(PromptVersion).where(PromptVersion.template_id == template_id).order_by(PromptVersion.version_no.desc()))
        .scalars()
        .all()
    )
    return [
        PromptVersionOut(
            id=row.id,
            template_id=row.template_id,
            version_no=row.version_no,
            content=row.content,
            is_active=row.is_active,
            created_at=row.created_at,
        )
        for row in rows
    ]


@router.put("/templates/{template_id}/versions/{version_id}", response_model=PromptVersionOut)
def update_prompt_version(
    template_id: int,
    version_id: int,
    payload: PromptVersionUpdate,
    db: Session = Depends(get_db),
) -> PromptVersionOut:
    tpl = db.get(PromptTemplate, template_id)
    if not tpl:
        raise HTTPException(status_code=404, detail="Prompt template not found.")
    ver = db.get(PromptVersion, version_id)
    if not ver or ver.template_id != template_id:
        raise HTTPException(status_code=404, detail="Prompt version not found.")
    ver.content = payload.content
    db.commit()
    db.refresh(ver)
    return PromptVersionOut(
        id=ver.id,
        template_id=ver.template_id,
        version_no=ver.version_no,
        content=ver.content,
        is_active=ver.is_active,
        created_at=ver.created_at,
    )


@router.post("/templates/{template_id}/activate", response_model=PromptTemplateOut)
def activate_prompt_version(
    template_id: int,
    payload: PromptActivateIn,
    db: Session = Depends(get_db),
) -> PromptTemplateOut:
    tpl = db.get(PromptTemplate, template_id)
    if not tpl:
        raise HTTPException(status_code=404, detail="Prompt template not found.")

    ver = db.get(PromptVersion, payload.version_id)
    if not ver or ver.template_id != template_id:
        raise HTTPException(status_code=404, detail="Prompt version not found.")
    activate_version(db, template_id=template_id, version_id=payload.version_id)
    db.refresh(tpl)
    return _template_out(db, tpl)


@router.post("/templates/{template_id}/rollback/{version_id}", response_model=PromptTemplateOut)
def rollback_prompt_version(template_id: int, version_id: int, db: Session = Depends(get_db)) -> PromptTemplateOut:
    tpl = db.get(PromptTemplate, template_id)
    if not tpl:
        raise HTTPException(status_code=404, detail="Prompt template not found.")
    ver = db.get(PromptVersion, version_id)
    if not ver or ver.template_id != template_id:
        raise HTTPException(status_code=404, detail="Prompt version not found.")
    activate_version(db, template_id=template_id, version_id=version_id)
    db.refresh(tpl)
    return _template_out(db, tpl)


@router.delete("/templates/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_prompt_template(template_id: int, db: Session = Depends(get_db)) -> Response:
    tpl = db.get(PromptTemplate, template_id)
    if not tpl:
        raise HTTPException(status_code=404, detail="Prompt template not found.")
    db.delete(tpl)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
