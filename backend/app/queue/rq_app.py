from redis import Redis
from rq import Queue

from app.core.config import settings

QUEUE_NAME = "xhsocr_tasks"


def get_redis() -> Redis:
    return Redis.from_url(settings.redis_url)


def get_queue() -> Queue:
    return Queue(QUEUE_NAME, connection=get_redis())
