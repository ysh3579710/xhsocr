from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.deps import get_db
from app.models.entities import Prompt, Task
from app.schemas.prompts import LLMModelConfigOut, LLMModelUpdate, PromptCreateIn, PromptOut, PromptUpdateIn
from app.services.llm_settings import get_active_llm_model, list_supported_llm_models, set_active_llm_model

router = APIRouter(prefix="/prompts", tags=["prompts"])


def _to_out(prompt: Prompt) -> PromptOut:
    return PromptOut(
        id=prompt.id,
        track=prompt.track,
        name=prompt.name,
        content=prompt.content,
        enabled=prompt.enabled,
        created_at=prompt.created_at,
        updated_at=prompt.updated_at,
    )


@router.get("/llm-model", response_model=LLMModelConfigOut)
def get_llm_model_config(db: Session = Depends(get_db)) -> LLMModelConfigOut:
    return LLMModelConfigOut(
        active_model=get_active_llm_model(db),
        supported_models=list_supported_llm_models(),
    )


@router.put("/llm-model", response_model=LLMModelConfigOut)
def update_llm_model_config(payload: LLMModelUpdate, db: Session = Depends(get_db)) -> LLMModelConfigOut:
    try:
        active_model = set_active_llm_model(db, payload.active_model)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return LLMModelConfigOut(
        active_model=active_model,
        supported_models=list_supported_llm_models(),
    )


@router.get("/tracks", response_model=list[str])
def list_tracks(db: Session = Depends(get_db)) -> list[str]:
    rows = (
        db.execute(select(Prompt.track).distinct().where(Prompt.track != "").order_by(Prompt.track.asc()))
        .scalars()
        .all()
    )
    return [r for r in rows if r]


@router.get("", response_model=list[PromptOut])
def list_prompts(
    track: str | None = Query(default=None),
    enabled: bool | None = Query(default=None),
    q: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[PromptOut]:
    stmt = select(Prompt)
    if track:
        stmt = stmt.where(Prompt.track == track.strip())
    if enabled is not None:
        stmt = stmt.where(Prompt.enabled.is_(enabled))
    if q:
        keyword = f"%{q.strip()}%"
        stmt = stmt.where(Prompt.name.ilike(keyword))
    stmt = stmt.order_by(Prompt.updated_at.desc(), Prompt.id.desc())
    rows = db.execute(stmt).scalars().all()
    return [_to_out(row) for row in rows]


@router.post("", response_model=PromptOut, status_code=status.HTTP_201_CREATED)
def create_prompt(payload: PromptCreateIn, db: Session = Depends(get_db)) -> PromptOut:
    prompt = Prompt(
        track=payload.track.strip(),
        name=payload.name.strip(),
        content=payload.content,
        enabled=payload.enabled,
    )
    db.add(prompt)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="同赛道下提示词名称已存在。")
    db.refresh(prompt)
    return _to_out(prompt)


@router.get("/{prompt_id}", response_model=PromptOut)
def get_prompt(prompt_id: int, db: Session = Depends(get_db)) -> PromptOut:
    prompt = db.get(Prompt, prompt_id)
    if not prompt:
        raise HTTPException(status_code=404, detail="Prompt not found.")
    return _to_out(prompt)


@router.put("/{prompt_id}", response_model=PromptOut)
def update_prompt(prompt_id: int, payload: PromptUpdateIn, db: Session = Depends(get_db)) -> PromptOut:
    prompt = db.get(Prompt, prompt_id)
    if not prompt:
        raise HTTPException(status_code=404, detail="Prompt not found.")

    if payload.track is not None:
        prompt.track = payload.track.strip()
    if payload.name is not None:
        prompt.name = payload.name.strip()
    if payload.content is not None:
        prompt.content = payload.content
    if payload.enabled is not None:
        prompt.enabled = payload.enabled

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="同赛道下提示词名称已存在。")
    db.refresh(prompt)
    return _to_out(prompt)


@router.post("/{prompt_id}/enable", response_model=PromptOut)
def enable_prompt(prompt_id: int, db: Session = Depends(get_db)) -> PromptOut:
    prompt = db.get(Prompt, prompt_id)
    if not prompt:
        raise HTTPException(status_code=404, detail="Prompt not found.")
    prompt.enabled = True
    db.commit()
    db.refresh(prompt)
    return _to_out(prompt)


@router.post("/{prompt_id}/disable", response_model=PromptOut)
def disable_prompt(prompt_id: int, db: Session = Depends(get_db)) -> PromptOut:
    prompt = db.get(Prompt, prompt_id)
    if not prompt:
        raise HTTPException(status_code=404, detail="Prompt not found.")
    prompt.enabled = False
    db.commit()
    db.refresh(prompt)
    return _to_out(prompt)


@router.delete("/{prompt_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_prompt(prompt_id: int, db: Session = Depends(get_db)) -> Response:
    prompt = db.get(Prompt, prompt_id)
    if not prompt:
        raise HTTPException(status_code=404, detail="Prompt not found.")

    referenced = db.execute(select(func.count(Task.id)).where(Task.prompt_id == prompt_id)).scalar_one()
    if referenced > 0:
        raise HTTPException(status_code=409, detail="提示词已被任务引用，不能删除。请先禁用。")

    db.delete(prompt)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

