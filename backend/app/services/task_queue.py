from rq.job import Job

from app.queue.rq_app import get_queue
from app.services.task_processor import process_task


def enqueue_task(task_id: int) -> Job:
    queue = get_queue()
    return queue.enqueue(process_task, task_id, job_timeout=1800)
