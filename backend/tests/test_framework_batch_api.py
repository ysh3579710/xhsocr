import unittest

from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app.db.session import SessionLocal
from app.main import app
from app.models.entities import Book, Prompt, Task, TaskImage, TaskStatus


class FrameworkBatchApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.db = SessionLocal()
        self.client = TestClient(app)
        self.created_task_ids: list[int] = []
        self.created_prompt_ids: list[int] = []

    def tearDown(self) -> None:
        self.db.rollback()
        if self.created_task_ids:
            self.db.execute(delete(TaskImage).where(TaskImage.task_id.in_(self.created_task_ids)))
            self.db.execute(delete(Task).where(Task.id.in_(self.created_task_ids)))
        if self.created_prompt_ids:
            self.db.execute(delete(Prompt).where(Prompt.id.in_(self.created_prompt_ids)))
        self.db.commit()
        self.db.close()

    def _first_book_id(self) -> int:
        book = self.db.execute(select(Book).order_by(Book.id.asc())).scalars().first()
        self.assertIsNotNone(book)
        return int(book.id)

    def _create_prompt(self, *, track: str, name: str, model: str) -> Prompt:
        prompt = Prompt(
            track=track,
            name=name,
            content=f"{name} content",
            enabled=True,
            llm_model=model,
            attribute=None,
        )
        self.db.add(prompt)
        self.db.commit()
        self.db.refresh(prompt)
        self.created_prompt_ids.append(prompt.id)
        return prompt

    def test_framework_batch_accepts_per_group_prompt_ids(self) -> None:
        book_id = self._first_book_id()
        prompt_a = self._create_prompt(track="教师赛道", name="框架批量提示词A", model="openai/gpt-5.3-chat")
        prompt_b = self._create_prompt(track="管理赛道", name="框架批量提示词B", model="claude-sonnet-4.6")

        bindings = [
            {"folder_name": "任务A", "book_id": book_id, "prompt_id": prompt_a.id},
            {"folder_name": "任务B", "book_id": book_id, "prompt_id": prompt_b.id},
        ]
        files = [
            ("files", ("任务A/001_a.jpg", b"test-a", "image/jpeg")),
            ("files", ("任务B/001_b.jpg", b"test-b", "image/jpeg")),
        ]

        response = self.client.post(
            "/tasks/framework",
            data={
                "bindings": str(bindings).replace("'", '"'),
                "batch_name": "测试框架批次",
                "auto_enqueue": "false",
            },
            files=files,
        )

        self.assertEqual(response.status_code, 201)
        task_ids = response.json()["task_ids"]
        self.created_task_ids.extend(task_ids)
        self.assertEqual(len(task_ids), 2)

        tasks = self.db.execute(select(Task).where(Task.id.in_(task_ids)).order_by(Task.folder_name.asc())).scalars().all()
        self.assertEqual(tasks[0].folder_name, "任务A")
        self.assertEqual(tasks[0].prompt_id, prompt_a.id)
        self.assertEqual(tasks[0].prompt_snapshot, prompt_a.content)
        self.assertEqual(tasks[0].llm_model, prompt_a.llm_model)
        self.assertEqual(tasks[0].status, TaskStatus.waiting)
        self.assertEqual(tasks[1].folder_name, "任务B")
        self.assertEqual(tasks[1].prompt_id, prompt_b.id)
        self.assertEqual(tasks[1].prompt_snapshot, prompt_b.content)
        self.assertEqual(tasks[1].llm_model, prompt_b.llm_model)
        self.assertEqual(tasks[1].status, TaskStatus.waiting)


if __name__ == "__main__":
    unittest.main()
