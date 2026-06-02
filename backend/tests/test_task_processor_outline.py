import unittest
from unittest.mock import patch

from sqlalchemy import delete, select

from app.db.session import SessionLocal
from app.models.entities import Book, BookSegment, Task, TaskResult, TaskStatus, TaskType
from app.services.task_processor import _extract_outline_with_internal_prompt
from app.services.task_processor import process_task


class _FakeLLM:
    def __init__(self, response: str) -> None:
        self.response = response

    def chat(self, prompt: str) -> str:
        return self.response


class TaskProcessorOutlineTests(unittest.TestCase):
    def test_extract_outline_accepts_plain_json(self) -> None:
        llm = _FakeLLM('{"title":"主标题","points":["观点一","观点二"]}')
        title, points_text, outline = _extract_outline_with_internal_prompt(llm, "原文")
        self.assertEqual(title, "主标题")
        self.assertEqual(points_text, "观点一\n观点二")
        self.assertIn("主标题", outline)

    def test_extract_outline_accepts_fenced_json(self) -> None:
        llm = _FakeLLM('```json\n{"title":"主标题","points":["观点一","观点二"]}\n```')
        title, points_text, outline = _extract_outline_with_internal_prompt(llm, "原文")
        self.assertEqual(title, "主标题")
        self.assertEqual(points_text, "观点一\n观点二")
        self.assertIn("观点一", outline)

    def test_extract_outline_accepts_prefixed_json(self) -> None:
        llm = _FakeLLM('下面是结果：\n{"title":"主标题","points":["观点一","观点二"]}')
        title, points_text, outline = _extract_outline_with_internal_prompt(llm, "原文")
        self.assertEqual(title, "主标题")
        self.assertEqual(points_text, "观点一\n观点二")
        self.assertIn("观点二", outline)


class _RecordingLLM:
    init_models: list[str] = []
    prompts_by_model: dict[str, list[str]] = {}

    def __init__(self, model: str | None = None) -> None:
        self.model = model or ""
        self.__class__.init_models.append(self.model)
        self.__class__.prompts_by_model.setdefault(self.model, [])

    def chat(self, prompt: str) -> str:
        self.__class__.prompts_by_model[self.model].append(prompt)
        if self.model == "openai/gpt-5.3-chat":
            return '{"title":"框架标题","points":["观点一","观点二"]}'
        return "框架标题\n这是正文"


class FrameworkExtractionModelRoutingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.db = SessionLocal()
        self.created_task_ids: list[int] = []
        _RecordingLLM.init_models = []
        _RecordingLLM.prompts_by_model = {}

    def tearDown(self) -> None:
        if self.created_task_ids:
            self.db.execute(delete(TaskResult).where(TaskResult.task_id.in_(self.created_task_ids)))
            self.db.execute(delete(Task).where(Task.id.in_(self.created_task_ids)))
            self.db.commit()
        self.db.close()

    def test_framework_extraction_uses_fixed_gpt53_chat_while_compose_uses_active_model(self) -> None:
        book = self.db.execute(select(Book).order_by(Book.id.asc())).scalars().first()
        self.assertIsNotNone(book)
        segment = (
            self.db.execute(select(BookSegment).where(BookSegment.book_id == book.id).order_by(BookSegment.segment_index.asc()))
            .scalars()
            .first()
        )
        self.assertIsNotNone(segment)

        task = Task(
            task_type=TaskType.framework,
            folder_name="测试框架任务",
            status=TaskStatus.waiting,
            book_id=book.id,
            prompt_snapshot="{title}\n{points}\n{outline}",
        )
        self.db.add(task)
        self.db.flush()
        self.db.add(TaskResult(task_id=task.id, original_note_text="测试原文"))
        self.db.commit()
        self.created_task_ids.append(task.id)

        with patch("app.services.task_processor.LLMClient", _RecordingLLM), patch(
            "app.services.task_processor.get_active_llm_model",
            return_value="claude-sonnet-4.6",
        ):
            process_task(task.id)

        self.assertEqual(_RecordingLLM.init_models.count("openai/gpt-5.3-chat"), 1)
        self.assertEqual(_RecordingLLM.init_models.count("claude-sonnet-4.6"), 1)
        extract_prompts = _RecordingLLM.prompts_by_model["openai/gpt-5.3-chat"]
        compose_prompts = _RecordingLLM.prompts_by_model["claude-sonnet-4.6"]
        self.assertEqual(len(extract_prompts), 1)
        self.assertEqual(len(compose_prompts), 1)
        self.assertIn("严格只输出 JSON", extract_prompts[0])
        self.assertIn("大标题：框架标题", compose_prompts[0])


if __name__ == "__main__":
    unittest.main()
