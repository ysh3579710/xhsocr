import unittest

from fastapi.testclient import TestClient
from sqlalchemy import delete

from app.db.session import SessionLocal
from app.main import app
from app.models.entities import Batch, BatchType, FeaturedNote, Task, TaskResult, TaskStatus, TaskType


class PaginationApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.db = SessionLocal()
        self.client = TestClient(app)
        self.prefix = "PAGINATION_TEST"
        self.created_task_ids: list[int] = []
        self.created_batch_ids: list[int] = []
        self.created_featured_ids: list[int] = []

    def tearDown(self) -> None:
        self.db.rollback()
        if self.created_featured_ids:
            self.db.execute(delete(FeaturedNote).where(FeaturedNote.id.in_(self.created_featured_ids)))
        if self.created_task_ids:
            self.db.execute(delete(TaskResult).where(TaskResult.task_id.in_(self.created_task_ids)))
            self.db.execute(delete(Task).where(Task.id.in_(self.created_task_ids)))
        if self.created_batch_ids:
            self.db.execute(delete(Batch).where(Batch.id.in_(self.created_batch_ids)))
        self.db.commit()
        self.db.close()

    def _create_task(self, *, task_type: TaskType, folder_name: str, full_output: str | None = None, extracted_title: str | None = None, batch_id: int | None = None) -> int:
        task = Task(
            task_type=task_type,
            title=folder_name if task_type == TaskType.create else None,
            folder_name=folder_name,
            batch_id=batch_id,
            status=TaskStatus.success,
        )
        self.db.add(task)
        self.db.flush()
        self.db.add(
            TaskResult(
                task_id=task.id,
                full_output=full_output,
                extracted_title=extracted_title,
            )
        )
        self.db.commit()
        self.created_task_ids.append(task.id)
        return task.id

    def _create_batch(self, name: str, batch_type: BatchType = BatchType.ocr) -> int:
        batch = Batch(
            batch_name=name,
            batch_type=batch_type,
            total_count=0,
            success_count=0,
            failed_count=0,
            status=TaskStatus.waiting,
        )
        self.db.add(batch)
        self.db.commit()
        self.created_batch_ids.append(batch.id)
        return batch.id

    def _create_featured(self, title: str, full_text: str) -> int:
        note = FeaturedNote(title=title, full_text=full_text, is_manual=True)
        self.db.add(note)
        self.db.commit()
        self.created_featured_ids.append(note.id)
        return note.id

    def test_tasks_list_returns_paginated_shape(self) -> None:
        self._create_task(task_type=TaskType.ocr, folder_name="任务A", full_output=f"{self.prefix} Alpha 标题\n正文")
        self._create_task(task_type=TaskType.ocr, folder_name="任务B", full_output=f"{self.prefix} Beta 标题\n正文")
        self._create_task(task_type=TaskType.ocr, folder_name="任务C", full_output=f"{self.prefix} Gamma 标题\n正文")

        response = self.client.get(f"/tasks?task_type=ocr&page=1&page_size=2&title={self.prefix}")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("items", data)
        self.assertEqual(data["page"], 1)
        self.assertEqual(data["page_size"], 2)
        self.assertEqual(data["total"], 3)
        self.assertEqual(data["total_pages"], 2)
        self.assertEqual(len(data["items"]), 2)

    def test_tasks_title_search_filters_results(self) -> None:
        self._create_task(task_type=TaskType.ocr, folder_name="任务Alpha", full_output=f"{self.prefix} 英语背诵清单\n正文")
        self._create_task(task_type=TaskType.ocr, folder_name="任务Beta", full_output=f"{self.prefix} 语文课堂管理\n正文")

        response = self.client.get(f"/tasks?task_type=ocr&page=1&page_size=50&title={self.prefix}%20英语")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["total"], 1)
        self.assertEqual(data["items"][0]["display_title"], f"{self.prefix} 英语背诵清单")

    def test_featured_notes_list_returns_paginated_shape(self) -> None:
        self._create_featured(f"{self.prefix} 标题1", f"{self.prefix} 标题1\n正文")
        self._create_featured(f"{self.prefix} 标题2", f"{self.prefix} 标题2\n正文")
        self._create_featured(f"{self.prefix} 标题3", f"{self.prefix} 标题3\n正文")

        response = self.client.get(f"/featured-notes?page=1&page_size=2&title={self.prefix}")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["total"], 3)
        self.assertEqual(data["total_pages"], 2)
        self.assertEqual(len(data["items"]), 2)

    def test_featured_notes_title_search_filters_results(self) -> None:
        self._create_featured(f"{self.prefix} 课堂管理经验", f"{self.prefix} 课堂管理经验\n正文")
        self._create_featured(f"{self.prefix} 英语背诵技巧", f"{self.prefix} 英语背诵技巧\n正文")

        response = self.client.get(f"/featured-notes?page=1&page_size=50&title={self.prefix}%20英语")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["total"], 1)
        self.assertEqual(data["items"][0]["title"], f"{self.prefix} 英语背诵技巧")

    def test_batches_list_returns_paginated_shape(self) -> None:
        batch_ids = [
            self._create_batch(f"{self.prefix} 批次1"),
            self._create_batch(f"{self.prefix} 批次2"),
            self._create_batch(f"{self.prefix} 批次3"),
        ]
        for index, batch_id in enumerate(batch_ids, start=1):
            self._create_task(
                task_type=TaskType.ocr,
                folder_name=f"{self.prefix} 批次任务{index}",
                full_output=f"{self.prefix} 批次标题{index}\n正文",
                batch_id=batch_id,
            )

        response = self.client.get("/batch?page=1&page_size=2")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertGreaterEqual(data["total"], 3)
        self.assertGreaterEqual(data["total_pages"], 2)
        self.assertEqual(len(data["items"]), 2)
        page_ids = {item["id"] for item in data["items"]}
        self.assertTrue(page_ids.intersection(batch_ids))

    def test_batch_tasks_list_returns_paginated_shape(self) -> None:
        batch_id = self._create_batch("任务批次", BatchType.ocr)
        self._create_task(task_type=TaskType.ocr, folder_name="任务1", full_output="标题1\n正文", batch_id=batch_id)
        self._create_task(task_type=TaskType.ocr, folder_name="任务2", full_output="标题2\n正文", batch_id=batch_id)
        self._create_task(task_type=TaskType.ocr, folder_name="任务3", full_output="标题3\n正文", batch_id=batch_id)

        response = self.client.get(f"/batch/{batch_id}/tasks?page=1&page_size=2")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["total"], 3)
        self.assertEqual(data["total_pages"], 2)
        self.assertEqual(len(data["items"]), 2)


if __name__ == "__main__":
    unittest.main()
