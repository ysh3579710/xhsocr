from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.batches import router as batches_router
from app.api.books import router as books_router
from app.api.health import router as health_router
from app.api.prompts import router as prompts_router
from app.api.tags import router as tags_router
from app.api.tasks import router as tasks_router
from app.core.config import settings

app = FastAPI(
    title="xhsocr-api",
    version="0.1.0",
    debug=settings.app_debug,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(books_router)
app.include_router(tags_router)
app.include_router(tasks_router)
app.include_router(batches_router)
app.include_router(prompts_router)
