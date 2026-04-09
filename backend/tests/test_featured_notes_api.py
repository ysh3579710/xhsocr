import unittest

from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app.db.session import SessionLocal, engine
from app.main import app
from app.models.entities import Book, FeaturedNote, Prompt, Task, TaskResult, TaskStatus, TaskType


class FeaturedNotesApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.db = SessionLocal()
        self.created_task_ids: list[int] = []
        self.created_featured_ids: list[int] = []
        with engine.begin() as conn:
            conn.execute(delete(FeaturedNote).where(FeaturedNote.title.like("测试标题%")))
        self.client = TestClient(app)

    def tearDown(self) -> None:
        self.db.rollback()
        if self.created_featured_ids:
            self.db.execute(delete(FeaturedNote).where(FeaturedNote.id.in_(self.created_featured_ids)))
        if self.created_task_ids:
            self.db.execute(delete(TaskResult).where(TaskResult.task_id.in_(self.created_task_ids)))
            self.db.execute(delete(Task).where(Task.id.in_(self.created_task_ids)))
        self.db.commit()
        self.db.close()

    def _create_task(self, task_type: TaskType, status: TaskStatus, full_output: str, *, extracted_title: str | None = None, extracted_points_text: str | None = None) -> int:
        task = Task(
            task_type=task_type,
            title="测试任务标题" if task_type == TaskType.create else None,
            folder_name="测试任务",
            status=status,
        )
        self.db.add(task)
        self.db.flush()
        self.db.add(
            TaskResult(
                task_id=task.id,
                full_output=full_output,
                extracted_title=extracted_title,
                extracted_points_text=extracted_points_text,
            )
        )
        self.db.commit()
        self.created_task_ids.append(task.id)
        return task.id

    def _get_book_and_prompt(self) -> tuple[int, int]:
        book = self.db.execute(select(Book).order_by(Book.id.asc())).scalars().first()
        prompt = self.db.execute(select(Prompt).where(Prompt.enabled.is_(True)).order_by(Prompt.id.asc())).scalars().first()
        self.assertIsNotNone(book)
        self.assertIsNotNone(prompt)
        return book.id, prompt.id

    def test_list_featured_notes_route_exists(self) -> None:
        response = self.client.get("/featured-notes")
        self.assertEqual(response.status_code, 200)
        self.assertIsInstance(response.json(), list)

    def test_create_manual_featured_note_route_exists(self) -> None:
        response = self.client.post(
            "/featured-notes/manual",
            json={
                "content": "标题\n这是正文第一段\n这是正文第二段",
            },
        )
        self.assertEqual(response.status_code, 201)
        data = response.json()
        self.created_featured_ids.append(data["id"])
        self.assertEqual(data["title"], "标题")
        self.assertEqual(data["full_text"], "标题\n这是正文第一段\n这是正文第二段")
        self.assertTrue(data["is_manual"])

    def test_can_feature_success_ocr_task(self) -> None:
        task_id = self._create_task(TaskType.ocr, TaskStatus.success, "测试标题OCR\n正文内容")
        response = self.client.post(f"/tasks/{task_id}/feature")
        self.assertEqual(response.status_code, 201)
        data = response.json()
        self.created_featured_ids.append(data["id"])
        self.assertEqual(data["source_task_type"], "ocr")
        self.assertEqual(data["source_task_id"], task_id)
        self.assertEqual(data["title"], "测试标题OCR")
        self.assertEqual(data["full_text"], "测试标题OCR\n正文内容")

    def test_failed_task_cannot_be_featured(self) -> None:
        task_id = self._create_task(TaskType.ocr, TaskStatus.failed, "测试标题失败\n正文内容")
        response = self.client.post(f"/tasks/{task_id}/feature")
        self.assertEqual(response.status_code, 400)

    def test_framework_task_feature_snapshots_structure(self) -> None:
        task_id = self._create_task(
            TaskType.framework,
            TaskStatus.success,
            "框架标题\n正文内容",
            extracted_title="框架标题",
            extracted_points_text="1. 观点一\n2. 观点二",
        )
        response = self.client.post(f"/tasks/{task_id}/feature")
        self.assertEqual(response.status_code, 201)
        data = response.json()
        self.created_featured_ids.append(data["id"])
        self.assertEqual(data["structured_title"], "框架标题")
        self.assertEqual(data["structured_points_text"], "1. 观点一\n2. 观点二")

    def test_create_task_prefers_task_title_when_featured(self) -> None:
        task_id = self._create_task(TaskType.create, TaskStatus.success, "最终文本第一行\n正文内容")
        response = self.client.post(f"/tasks/{task_id}/feature")
        self.assertEqual(response.status_code, 201)
        data = response.json()
        self.created_featured_ids.append(data["id"])
        self.assertEqual(data["title"], "测试任务标题")

    def test_can_unfeature_task(self) -> None:
        task_id = self._create_task(TaskType.ocr, TaskStatus.success, "测试标题删除\n正文内容")
        create_response = self.client.post(f"/tasks/{task_id}/feature")
        self.assertEqual(create_response.status_code, 201)
        note_id = create_response.json()["id"]
        self.created_featured_ids.append(note_id)

        delete_response = self.client.delete(f"/tasks/{task_id}/feature")
        self.assertEqual(delete_response.status_code, 204)

        list_response = self.client.get("/featured-notes")
        ids = [item["id"] for item in list_response.json()]
        self.assertNotIn(note_id, ids)

    def test_task_list_and_detail_expose_feature_state(self) -> None:
        task_id = self._create_task(TaskType.ocr, TaskStatus.success, "测试标题状态\n正文内容")
        create_response = self.client.post(f"/tasks/{task_id}/feature")
        self.assertEqual(create_response.status_code, 201)
        note_id = create_response.json()["id"]
        self.created_featured_ids.append(note_id)

        list_response = self.client.get("/tasks")
        self.assertEqual(list_response.status_code, 200)
        task_item = next(item for item in list_response.json() if item["id"] == task_id)
        self.assertTrue(task_item["is_featured"])
        self.assertEqual(task_item["featured_note_id"], note_id)

        detail_response = self.client.get(f"/tasks/{task_id}")
        self.assertEqual(detail_response.status_code, 200)
        detail = detail_response.json()
        self.assertTrue(detail["is_featured"])
        self.assertEqual(detail["featured_note_id"], note_id)

    def test_can_spawn_rewrite_task_from_featured_note(self) -> None:
        task_id = self._create_task(TaskType.ocr, TaskStatus.success, "测试标题二创仿写\n正文内容")
        feature_response = self.client.post(f"/tasks/{task_id}/feature")
        self.assertEqual(feature_response.status_code, 201)
        note_id = feature_response.json()["id"]
        self.created_featured_ids.append(note_id)
        book_id, prompt_id = self._get_book_and_prompt()

        response = self.client.post(
            f"/featured-notes/{note_id}/spawn-rewrite",
            json={"task_name": "二次仿写任务", "book_id": book_id, "prompt_id": prompt_id, "auto_enqueue": False},
        )
        self.assertEqual(response.status_code, 201)
        new_task_id = response.json()["task_ids"][0]
        self.created_task_ids.append(new_task_id)
        new_task = self.db.get(Task, new_task_id)
        new_result = self.db.get(TaskResult, new_task_id)
        self.assertEqual(new_task.task_type, TaskType.ocr)
        self.assertEqual(new_task.folder_name, "二次仿写任务")
        self.assertEqual(new_result.original_note_text, "测试标题二创仿写\n正文内容")

    def test_can_spawn_create_task_from_featured_note(self) -> None:
        response = self.client.post(
            "/featured-notes/manual",
            json={"content": "手动精选标题\n正文第一段\n正文第二段"},
        )
        self.assertEqual(response.status_code, 201)
        note_id = response.json()["id"]
        self.created_featured_ids.append(note_id)
        _, prompt_id = self._get_book_and_prompt()

        spawn = self.client.post(
            f"/featured-notes/{note_id}/spawn-create",
            json={"title": "二次原创标题", "book_id": None, "prompt_id": prompt_id, "auto_enqueue": False},
        )
        self.assertEqual(spawn.status_code, 201)
        new_task_id = spawn.json()["task_ids"][0]
        self.created_task_ids.append(new_task_id)
        new_task = self.db.get(Task, new_task_id)
        self.assertEqual(new_task.task_type, TaskType.create)
        self.assertEqual(new_task.title, "二次原创标题")

    def test_can_spawn_framework_task_from_featured_note_with_structure(self) -> None:
        task_id = self._create_task(
            TaskType.framework,
            TaskStatus.success,
            "框架标题\n正文内容",
            extracted_title="框架标题",
            extracted_points_text="1. 观点一\n2. 观点二",
        )
        feature_response = self.client.post(f"/tasks/{task_id}/feature")
        self.assertEqual(feature_response.status_code, 201)
        note_id = feature_response.json()["id"]
        self.created_featured_ids.append(note_id)
        book_id, prompt_id = self._get_book_and_prompt()

        response = self.client.post(
            f"/featured-notes/{note_id}/spawn-framework",
            json={"task_name": "二次框架任务", "book_id": book_id, "prompt_id": prompt_id, "auto_enqueue": False},
        )
        self.assertEqual(response.status_code, 201)
        new_task_id = response.json()["task_ids"][0]
        self.created_task_ids.append(new_task_id)
        new_task = self.db.get(Task, new_task_id)
        new_result = self.db.get(TaskResult, new_task_id)
        self.assertEqual(new_task.task_type, TaskType.framework)
        self.assertEqual(new_task.folder_name, "二次框架任务")
        self.assertEqual(new_result.extracted_title, "框架标题")
        self.assertEqual(new_result.extracted_points_text, "1. 观点一\n2. 观点二")


if __name__ == "__main__":
    unittest.main()
