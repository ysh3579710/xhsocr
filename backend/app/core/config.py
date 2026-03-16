from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_env: str = "local"
    app_debug: bool = True
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    database_url: str = "postgresql+psycopg://xhsocr:change_me@127.0.0.1:5432/xhsocr"
    redis_url: str = "redis://127.0.0.1:6379/0"
    storage_root: str = "./storage"
    book_root: str = "./storage/books"
    task_root: str = "./storage/tasks"
    ocr_provider: str = "rapidocr_onnxruntime"
    ocr_lang: str = "ch"
    ocr_timeout_seconds: int = 90
    ocr_isolate_subprocess: bool = True
    ocr_allow_unstable_runtime: bool = False
    ocr_auto_downgrade_macos: bool = True
    llm_provider: str = "mock"
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    openrouter_api_key: str = ""
    openrouter_model: str = "openai/gpt-5-mini"
    llm_timeout_seconds: int = 300
    llm_retry_count: int = 1
    llm_retry_backoff_seconds: int = 1

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )


settings = Settings()
