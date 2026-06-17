import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app.db.session import SessionLocal
from app.main import app
from app.models.entities import Book, Task, TaskResult, TaskStatus, TaskType
from app.services.task_processor import process_task


class _StaticLLM:
    response = ""

    def __init__(self, model: str | None = None) -> None:
        self.model = model or ""

    def chat(self, prompt: str) -> str:
        return self.__class__.response


class TaskOutputFormattingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.db = SessionLocal()
        self.client = TestClient(app)
        self.created_task_ids: list[int] = []

    def tearDown(self) -> None:
        self.db.rollback()
        if self.created_task_ids:
            self.db.execute(delete(TaskResult).where(TaskResult.task_id.in_(self.created_task_ids)))
            self.db.execute(delete(Task).where(Task.id.in_(self.created_task_ids)))
            self.db.commit()
        self.db.close()

    def _first_book_id(self) -> int:
        book = self.db.execute(select(Book).order_by(Book.id.asc())).scalars().first()
        self.assertIsNotNone(book)
        return int(book.id)

    def test_create_task_formats_output_and_preserves_raw_output(self) -> None:
        task = Task(
            task_type=TaskType.create,
            title="测试原创标题",
            folder_name="测试原创任务",
            status=TaskStatus.waiting,
            prompt_snapshot="{title}",
        )
        self.db.add(task)
        self.db.commit()
        self.created_task_ids.append(task.id)

        raw_output = (
            "正文第一段\n"
            "正文第二段\n"
            "---\n"
            "小红书推荐正文\n"
            "这是一段推荐正文。\n"
            "---\n"
            "标签\n"
            "#原创 #写作"
        )
        _StaticLLM.response = raw_output

        with patch("app.services.task_processor.LLMClient", _StaticLLM):
            process_task(task.id)

        result = self.db.get(TaskResult, task.id)
        self.assertIsNotNone(result)
        self.assertEqual(getattr(result, "raw_output", None), raw_output)
        self.assertEqual(
            result.full_output,
            "测试原创标题\n\n"
            "正文第一段\n"
            "正文第二段\n\n"
            "小红书推荐正文：\n"
            "这是一段推荐正文。\n\n"
            "#原创 #写作",
        )

    def test_create_task_keeps_generated_title_when_first_line_is_valid_title(self) -> None:
        task = Task(
            task_type=TaskType.create,
            title="创建任务标题",
            folder_name="测试原创任务保留标题",
            status=TaskStatus.waiting,
            prompt_snapshot="{title}",
        )
        self.db.add(task)
        self.db.commit()
        self.created_task_ids.append(task.id)

        raw_output = (
            "模型生成标题更合适\n"
            "正文第一段\n"
            "小红书推荐正文\n"
            "这是一段推荐正文。\n"
            "#原创 #标题"
        )
        _StaticLLM.response = raw_output

        with patch("app.services.task_processor.LLMClient", _StaticLLM):
            process_task(task.id)

        result = self.db.get(TaskResult, task.id)
        self.assertEqual(
            result.full_output,
            "模型生成标题更合适\n\n"
            "正文第一段\n\n"
            "小红书推荐正文：\n"
            "这是一段推荐正文。\n\n"
            "#原创 #标题",
        )

    def test_ocr_task_keeps_single_line_title_and_exposes_raw_output_in_detail_api(self) -> None:
        task = Task(
            task_type=TaskType.ocr,
            folder_name="测试仿写任务",
            status=TaskStatus.waiting,
            book_id=self._first_book_id(),
            prompt_snapshot="{original_note}",
        )
        self.db.add(task)
        self.db.flush()
        self.db.add(TaskResult(task_id=task.id, original_note_text="原始笔记"))
        self.db.commit()
        self.created_task_ids.append(task.id)

        raw_output = (
            "学生基础弱，时间又少，我是这样抓听写默写\n"
            "听写这件事，说小不小，说大不大。\n"
            "第二部分：小红书推荐正文\n"
            "基础弱、时间少，听写默写真的很难抓？\n"
            "第三部分：小红书标签\n"
            "#班级管理 #教学干货"
        )
        _StaticLLM.response = raw_output

        with patch("app.services.task_processor.LLMClient", _StaticLLM):
            process_task(task.id)

        detail = self.client.get(f"/tasks/{task.id}")
        self.assertEqual(detail.status_code, 200)
        data = detail.json()
        self.assertEqual(data["raw_output"], raw_output)
        self.assertEqual(
            data["full_output"],
            "学生基础弱，时间又少，我是这样抓听写默写\n\n"
            "听写这件事，说小不小，说大不大。\n\n"
            "小红书推荐正文：\n"
            "基础弱、时间少，听写默写真的很难抓？\n\n"
            "#班级管理 #教学干货",
        )

    def test_ocr_task_merges_multiline_title_block(self) -> None:
        task = Task(
            task_type=TaskType.ocr,
            folder_name="测试仿写任务多行标题",
            status=TaskStatus.waiting,
            book_id=self._first_book_id(),
            prompt_snapshot="{original_note}",
        )
        self.db.add(task)
        self.db.flush()
        self.db.add(TaskResult(task_id=task.id, original_note_text="原始笔记"))
        self.db.commit()
        self.created_task_ids.append(task.id)

        raw_output = (
            "学生基础弱\n"
            "时间又少\n"
            "我是这样抓听写默写\n"
            "听写这件事，说小不小，说大不大。\n"
            "小红书推荐正文\n"
            "基础弱、时间少，听写默写真的很难抓？\n"
            "#班级管理 #教学干货"
        )
        _StaticLLM.response = raw_output

        with patch("app.services.task_processor.LLMClient", _StaticLLM):
            process_task(task.id)

        result = self.db.get(TaskResult, task.id)
        self.assertEqual(
            result.full_output,
            "学生基础弱，时间又少，我是这样抓听写默写\n\n"
            "听写这件事，说小不小，说大不大。\n\n"
            "小红书推荐正文：\n"
            "基础弱、时间少，听写默写真的很难抓？\n\n"
            "#班级管理 #教学干货",
        )

    def test_framework_task_prefers_extracted_title_when_raw_output_starts_with_body(self) -> None:
        task = Task(
            task_type=TaskType.framework,
            folder_name="测试框架任务",
            status=TaskStatus.waiting,
            book_id=self._first_book_id(),
            prompt_snapshot="{title}\n{points}\n{outline}",
        )
        self.db.add(task)
        self.db.flush()
        self.db.add(
            TaskResult(
                task_id=task.id,
                original_note_text="原始笔记",
                extracted_title="框架任务标题",
                extracted_points_text="观点一\n观点二",
            )
        )
        self.db.commit()
        self.created_task_ids.append(task.id)

        raw_output = (
            "正文第一段\n"
            "正文第二段\n"
            "小红书推荐正文\n"
            "这是一段推荐正文。\n"
            "标签\n"
            "#框架 #原创"
        )
        _StaticLLM.response = raw_output

        with patch("app.services.task_processor.LLMClient", _StaticLLM):
            process_task(task.id)

        result = self.db.get(TaskResult, task.id)
        self.assertEqual(
            result.full_output,
            "框架任务标题\n\n"
            "正文第一段\n"
            "正文第二段\n\n"
            "小红书推荐正文：\n"
            "这是一段推荐正文。\n\n"
            "#框架 #原创",
        )


if __name__ == "__main__":
    unittest.main()
