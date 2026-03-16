from __future__ import annotations

import os
import platform
import sys

from rq.worker import SimpleWorker

from app.queue.rq_app import QUEUE_NAME, get_redis


def _apply_runtime_stability_tweaks() -> None:
    # Paddle/Python on macOS can crash with aggressive BLAS/OpenMP threading.
    if platform.system() == "Darwin":
        os.environ.setdefault("OMP_NUM_THREADS", "1")
        os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
        os.environ.setdefault("MKL_NUM_THREADS", "1")
        os.environ.setdefault("VECLIB_MAXIMUM_THREADS", "1")
        os.environ.setdefault("NUMEXPR_NUM_THREADS", "1")


def _ensure_venv_python() -> None:
    prefix = os.path.realpath(sys.prefix).replace("\\", "/")
    venv = os.path.realpath(os.environ.get("VIRTUAL_ENV", "")).replace("\\", "/")
    in_project_venv = prefix.endswith("/backend/.venv") or venv.endswith("/backend/.venv")
    if not in_project_venv:
        exe = os.path.realpath(sys.executable)
        raise RuntimeError(
            "Worker must run with backend/.venv Python. "
            f"Current executable: {exe}; sys.prefix: {sys.prefix}. "
            "Please run: cd backend && source .venv/bin/activate && python worker.py"
        )


def run_worker() -> None:
    _apply_runtime_stability_tweaks()
    _ensure_venv_python()
    redis_conn = get_redis()
    # macOS + Python 3.9 environment may crash on forked work-horse processes.
    # Use SimpleWorker to execute jobs in-process for stability in local MVP runs.
    worker = SimpleWorker([QUEUE_NAME], connection=redis_conn)
    worker.work()


if __name__ == "__main__":
    run_worker()
