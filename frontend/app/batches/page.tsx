"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PaginationControls } from "../../components/pagination-controls";
import { apiFetch } from "../../lib/api";
import { Batch, PaginatedResponse, Task } from "../../lib/types";

const PAGE_SIZE = 50;

function taskDetailPath(task: Task): string {
  if (task.task_type === "create") return `/create-tasks/${task.id}`;
  if (task.task_type === "framework") return `/framework-tasks/${task.id}`;
  return `/tasks/${task.id}`;
}

export default function BatchesPage() {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState<number | null>(null);
  const [batchPage, setBatchPage] = useState(1);
  const [batchTotal, setBatchTotal] = useState(0);
  const [batchTotalPages, setBatchTotalPages] = useState(1);
  const [taskPage, setTaskPage] = useState(1);
  const [taskTotal, setTaskTotal] = useState(0);
  const [taskTotalPages, setTaskTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function buildBatchPath(pageValue: number) {
    return `/batch?page=${pageValue}&page_size=${PAGE_SIZE}`;
  }

  function buildBatchTaskPath(batchId: number, pageValue: number) {
    return `/batch/${batchId}/tasks?page=${pageValue}&page_size=${PAGE_SIZE}`;
  }

  async function loadBatchTasks(batchId: number, nextTaskPage = taskPage) {
    const taskData = await apiFetch<PaginatedResponse<Task>>(buildBatchTaskPath(batchId, nextTaskPage));
    setTasks(taskData.items);
    setTaskPage(taskData.page);
    setTaskTotal(taskData.total);
    setTaskTotalPages(taskData.total_pages);
  }

  async function loadData(nextBatchPage = batchPage, nextTaskPage = taskPage) {
    setLoading(true);
    setError("");
    try {
      const batchData = await apiFetch<PaginatedResponse<Batch>>(buildBatchPath(nextBatchPage));
      setBatches(batchData.items);
      setBatchPage(batchData.page);
      setBatchTotal(batchData.total);
      setBatchTotalPages(batchData.total_pages);

      const hasSelectedOnPage = batchData.items.some((item) => item.id === selectedBatchId);
      const activeBatchId = hasSelectedOnPage ? selectedBatchId : (batchData.items[0]?.id ?? null);
      setSelectedBatchId(activeBatchId);

      if (activeBatchId) {
        await loadBatchTasks(activeBatchId, hasSelectedOnPage ? nextTaskPage : 1);
      } else {
        setTasks([]);
        setTaskPage(1);
        setTaskTotal(0);
        setTaskTotalPages(1);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, [batchPage]);

  useEffect(() => {
    if (!selectedBatchId) return;
    void loadBatchTasks(selectedBatchId, taskPage);
  }, [selectedBatchId, taskPage]);

  return (
    <div className="pageWrap">
      <header className="pageHeader rowHeader">
        <div>
          <h1>批次页</h1>
          <p>查看批次整体进度与子任务执行情况</p>
        </div>
        <button onClick={() => void loadData()} disabled={loading}>刷新</button>
      </header>
      {error ? <div className="errorBox">{error}</div> : null}

      <section className="card">
        <h2>批次列表</h2>
        <div className="table">
          <div className="thead trow7">
            <span>ID</span>
            <span>批次名</span>
            <span>类型</span>
            <span>状态</span>
            <span>总数</span>
            <span>成功</span>
            <span>失败</span>
          </div>
          {batches.map((b) => (
            <div
              key={b.id}
              className={`trow trow7 clickable ${selectedBatchId === b.id ? "active" : ""}`}
              onClick={() => {
                setSelectedBatchId(b.id);
                setTaskPage(1);
              }}
            >
              <span>{b.id}</span>
              <span>{b.batch_name}</span>
              <span>{b.batch_type}</span>
              <span>{b.status}</span>
              <span>{b.total_count}</span>
              <span>{b.success_count}</span>
              <span>{b.failed_count}</span>
            </div>
          ))}
          {batches.length === 0 ? <p className="empty">暂无批次</p> : null}
        </div>
        <PaginationControls
          page={batchPage}
          totalPages={batchTotalPages}
          total={batchTotal}
          pageSize={PAGE_SIZE}
          disabled={loading}
          onChange={setBatchPage}
        />
      </section>

      <section className="card">
        <h2>子任务列表 {selectedBatchId ? `(Batch #${selectedBatchId})` : ""}</h2>
        <div className="table">
          <div className="thead">
            <span>Task ID</span>
            <span>任务名</span>
            <span>书稿名称</span>
            <span>状态</span>
            <span>操作</span>
          </div>
          {tasks.map((t) => (
            <div key={t.id} className="trow">
              <span>{t.id}</span>
              <span>{t.folder_name}</span>
              <span>{t.book_name || (t.book_id ? `ID:${t.book_id}` : "-")}</span>
              <span>{t.status}</span>
              <span><Link className="linkBtn" href={taskDetailPath(t)}>查看详情</Link></span>
            </div>
          ))}
          {tasks.length === 0 ? <p className="empty">当前批次暂无子任务</p> : null}
        </div>
        <PaginationControls
          page={taskPage}
          totalPages={taskTotalPages}
          total={taskTotal}
          pageSize={PAGE_SIZE}
          disabled={loading || !selectedBatchId}
          onChange={setTaskPage}
        />
      </section>
    </div>
  );
}
