import unittest
import io
import zipfile

from fastapi.testclient import TestClient
from sqlalchemy import delete, select

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
        stale_task_ids = self.db.execute(
            select(Task.id).where(Task.folder_name.like(f"{self.prefix}%"))
        ).scalars().all()
        if stale_task_ids:
            self.db.execute(delete(TaskResult).where(TaskResult.task_id.in_(stale_task_ids)))
            self.db.execute(delete(Task).where(Task.id.in_(stale_task_ids)))
            self.db.commit()

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

    def test_batch_download_rejects_when_tasks_are_still_running(self) -> None:
        batch_id = self._create_batch("下载中批次", BatchType.ocr)
        task = Task(
            task_type=TaskType.ocr,
            folder_name="进行中任务",
            batch_id=batch_id,
            status=TaskStatus.processing,
        )
        self.db.add(task)
        self.db.flush()
        self.db.add(TaskResult(task_id=task.id, full_output="标题\n正文"))
        self.db.commit()
        self.created_task_ids.append(task.id)

        response = self.client.post(f"/batch/{batch_id}/download")
        self.assertEqual(response.status_code, 400)
        self.assertIn("进行中的任务", response.text)

    def test_batch_download_exports_only_tasks_with_full_output_after_completion(self) -> None:
        batch_id = self._create_batch("可下载批次", BatchType.ocr)
        self._create_task(task_type=TaskType.ocr, folder_name="成功任务A", full_output="标题A\n正文A", batch_id=batch_id)
        self._create_task(task_type=TaskType.ocr, folder_name="成功任务B", full_output="标题B\n正文B", batch_id=batch_id)
        self._create_task(task_type=TaskType.ocr, folder_name="空任务", full_output=None, batch_id=batch_id)

        response = self.client.post(f"/batch/{batch_id}/download")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["content-type"], "application/zip")

        with zipfile.ZipFile(io.BytesIO(response.content)) as zf:
          names = zf.namelist()
          self.assertEqual(len(names), 2)
          contents = [zf.read(name).decode("utf-8") for name in names]
          self.assertIn("标题A\n正文A", contents)
          self.assertIn("标题B\n正文B", contents)

        batch = self.db.get(Batch, batch_id)
        assert batch is not None
        self.assertEqual(batch.download_count, 1)
        self.assertIsNotNone(batch.last_downloaded_at)

        list_response = self.client.get("/batch?page=1&page_size=50")
        self.assertEqual(list_response.status_code, 200)
        items = list_response.json()["items"]
        batch_item = next(item for item in items if item["id"] == batch_id)
        self.assertEqual(batch_item["download_count"], 1)

    def test_retry_resets_download_markers_for_new_result_version(self) -> None:
        task_id = self._create_task(task_type=TaskType.ocr, folder_name="重试下载状态任务", full_output="标题\n正文")

        download_response = self.client.get(f"/tasks/{task_id}/download")
        self.assertEqual(download_response.status_code, 200)

        retry_response = self.client.post(f"/tasks/{task_id}/retry")
        self.assertEqual(retry_response.status_code, 200)
        retry_data = retry_response.json()
        self.assertEqual(retry_data["download_count"], 0)
        self.assertEqual(retry_data["retry_count"], 1)

        result = self.db.get(TaskResult, task_id)
        self.assertIsNotNone(result)
        self.assertEqual(result.download_count, 0)
        self.assertIsNone(result.last_downloaded_at)


if __name__ == "__main__":
    unittest.main()
