from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from typing import Optional

from app.db.deps import get_db
from app.models.entities import TagLibrary
from app.schemas.tags import FixedTagsOut, FixedTagsUpdate, TagCreate, TagOut, TagUpdate
from app.services.tag_settings import get_fixed_tags, set_fixed_tags

router = APIRouter(prefix="/tags", tags=["tags"])


def _to_out(tag: TagLibrary) -> TagOut:
    return TagOut(
        id=tag.id,
        tag_text=tag.tag_text,
        enabled=tag.enabled,
        created_at=tag.created_at,
        updated_at=tag.updated_at,
    )


@router.post("", response_model=TagOut, status_code=status.HTTP_201_CREATED)
def create_tag(payload: TagCreate, db: Session = Depends(get_db)) -> TagOut:
    tag = TagLibrary(tag_text=payload.tag_text.strip(), enabled=payload.enabled)
    db.add(tag)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Tag already exists.")
    db.refresh(tag)
    return _to_out(tag)


@router.get("", response_model=list[TagOut])
def list_tags(enabled: Optional[bool] = Query(default=None), db: Session = Depends(get_db)) -> list[TagOut]:
    stmt = select(TagLibrary).order_by(TagLibrary.created_at.desc())
    if enabled is not None:
        stmt = stmt.where(TagLibrary.enabled == enabled)
    tags = db.execute(stmt).scalars().all()
    return [_to_out(tag) for tag in tags]


@router.get("/fixed", response_model=FixedTagsOut)
def get_fixed_tags_config(db: Session = Depends(get_db)) -> FixedTagsOut:
    return FixedTagsOut(fixed_tags=get_fixed_tags(db))


@router.put("/fixed", response_model=FixedTagsOut)
def update_fixed_tags_config(payload: FixedTagsUpdate, db: Session = Depends(get_db)) -> FixedTagsOut:
    try:
        tags = set_fixed_tags(db, payload.fixed_tags)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return FixedTagsOut(fixed_tags=tags)


@router.put("/{tag_id}", response_model=TagOut)
def update_tag(tag_id: int, payload: TagUpdate, db: Session = Depends(get_db)) -> TagOut:
    tag = db.get(TagLibrary, tag_id)
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found.")

    if payload.tag_text is not None:
        tag.tag_text = payload.tag_text.strip()
    if payload.enabled is not None:
        tag.enabled = payload.enabled

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Tag already exists.")
    db.refresh(tag)
    return _to_out(tag)


@router.delete("/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_tag(tag_id: int, db: Session = Depends(get_db)) -> Response:
    tag = db.get(TagLibrary, tag_id)
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found.")
    db.delete(tag)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
