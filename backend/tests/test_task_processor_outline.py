import unittest

from app.services.task_processor import _extract_outline_with_internal_prompt


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


if __name__ == "__main__":
    unittest.main()
