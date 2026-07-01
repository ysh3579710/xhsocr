"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { PaginationControls } from "../../components/pagination-controls";
import { apiFetch } from "../../lib/api";
import { Batch, PaginatedResponse, Task } from "../../lib/types";

const PAGE_SIZE = 50;

function taskDetailPath(task: Task, batchId: number | null, taskPage: number): string {
  const base = task.task_type === "create"
    ? `/create-tasks/${task.id}`
    : task.task_type === "framework"
      ? `/framework-tasks/${task.id}`
      : `/tasks/${task.id}`;
  if (!batchId) return base;
  return `${base}?batch_id=${encodeURIComponent(batchId)}&task_page=${encodeURIComponent(taskPage)}`;
}

export default function BatchesPage() {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState<number | null>(null);
  const [batchPage, setBatchPage] = useState(1);
  const [batchTotal, setBatchTotal] = useState(0);
  const [batchTotalPages, setBatchTotalPages] = useState(1);
  const [taskPage, setTaskPage] = useState<number>(1);
  const [taskTotal, setTaskTotal] = useState(0);
  const [taskTotalPages, setTaskTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const downloadFrameRef = useRef<HTMLIFrameElement | null>(null);
  const downloadResetTimerRef = useRef<number | null>(null);
  const downloadRefreshTimerRef = useRef<number | null>(null);

  function buildBatchPath(pageValue: number) {
    return `/batch?page=${pageValue}&page_size=${PAGE_SIZE}`;
  }

  function buildBatchTaskPath(batchId: number, pageValue: number) {
    return `/batch/${batchId}/tasks?page=${pageValue}&page_size=${PAGE_SIZE}`;
  }

  function ensureDownloadFrame(): HTMLIFrameElement {
    if (downloadFrameRef.current) return downloadFrameRef.current;
    const frame = document.createElement("iframe");
    frame.name = "batch-download-frame";
    frame.style.display = "none";
    frame.setAttribute("aria-hidden", "true");
    frame.addEventListener("load", () => {
      setLoading(false);
      try {
        const text = frame.contentDocument?.body?.innerText?.trim() || "";
        if (!text) return;
        try {
          const payload = JSON.parse(text);
          const detail = typeof payload?.detail === "string" ? payload.detail : text;
          setError(detail);
        } catch {
          setError(text);
        }
      } catch {
        // Ignore iframe inspection failures for successful attachment downloads.
      }
    });
    document.body.appendChild(frame);
    downloadFrameRef.current = frame;
    return frame;
  }

  async function downloadBatch(batchId: number) {
    setError("");
    setLoading(true);
    const frame = ensureDownloadFrame();
    if (downloadResetTimerRef.current) {
      window.clearTimeout(downloadResetTimerRef.current);
    }
    if (downloadRefreshTimerRef.current) {
      window.clearTimeout(downloadRefreshTimerRef.current);
    }
    const form = document.createElement("form");
    form.method = "POST";
    form.action = `/api/batch/${batchId}/download`;
    form.target = frame.name;
    form.style.display = "none";
    document.body.appendChild(form);
    form.submit();
    document.body.removeChild(form);
    downloadResetTimerRef.current = window.setTimeout(() => {
      setLoading(false);
      downloadResetTimerRef.current = null;
    }, 2000);
    downloadRefreshTimerRef.current = window.setTimeout(() => {
      void loadData(batchPage, taskPage);
      downloadRefreshTimerRef.current = null;
    }, 1200);
  }

  async function retryAllBatch(batchId: number) {
    const ok = window.confirm("确认重试当前批次下的全部任务吗？已成功和已失败任务都会重新执行。");
    if (!ok) return;
    setError("");
    setLoading(true);
    try {
      await apiFetch<{ batch_id: number; retried_count: number }>(`/batch/${batchId}/retry-all`, { method: "POST" });
      await loadData(batchPage, taskPage);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function retryFailedBatch(batchId: number) {
    const ok = window.confirm("确认重写当前批次中的失败任务吗？已成功任务不会重新执行。");
    if (!ok) return;
    setError("");
    setLoading(true);
    try {
      await apiFetch<{ batch_id: number; retried_count: number }>(`/batch/${batchId}/retry-failed`, { method: "POST" });
      await loadData(batchPage, taskPage);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
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

      const params = new URLSearchParams(window.location.search);
      const batchIdQuery = params.get("batch_id");
      const taskPageQuery = params.get("task_page");
      const queryBatchId = batchIdQuery ? Number(batchIdQuery) : null;
      const queryTaskPage = taskPageQuery ? Number(taskPageQuery) : null;
      const hasSelectedOnPage = batchData.items.some((item) => item.id === selectedBatchId);
      const activeBatchId = hasSelectedOnPage ? selectedBatchId : (queryBatchId ?? batchData.items[0]?.id ?? null);
      setSelectedBatchId(activeBatchId);
      if (queryTaskPage && queryTaskPage !== taskPage) {
        setTaskPage(queryTaskPage);
      }

      if (activeBatchId) {
        await loadBatchTasks(activeBatchId, hasSelectedOnPage ? nextTaskPage : (queryTaskPage ?? taskPage));
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

  useEffect(() => {
    return () => {
      if (downloadResetTimerRef.current) {
        window.clearTimeout(downloadResetTimerRef.current);
      }
      if (downloadRefreshTimerRef.current) {
        window.clearTimeout(downloadRefreshTimerRef.current);
      }
      if (downloadFrameRef.current) {
        document.body.removeChild(downloadFrameRef.current);
        downloadFrameRef.current = null;
      }
    };
  }, []);

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
          <div className="thead trow8">
            <span>ID</span>
            <span>批次名</span>
            <span>类型</span>
            <span>状态</span>
            <span>总数</span>
            <span>成功</span>
            <span>失败</span>
            <span>操作</span>
          </div>
          {batches.map((b) => (
            <div
              key={b.id}
              className={`trow trow8 clickable ${selectedBatchId === b.id ? "active" : ""}`}
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
              <span className="tableActionCell">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    void downloadBatch(b.id);
                  }}
                  disabled={loading || b.status === "waiting" || b.status === "processing"}
                >
                  {b.download_count > 0 ? "重新下载当前批次" : "下载当前批次"}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    void retryAllBatch(b.id);
                  }}
                  disabled={loading || b.status === "waiting" || b.status === "processing"}
                >
                  全部重试
                </button>
                {b.status !== "waiting" && b.status !== "processing" && b.failed_count > 0 ? (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      void retryFailedBatch(b.id);
                    }}
                    disabled={loading}
                  >
                    重写
                  </button>
                ) : null}
              </span>
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
              <span><Link className="linkBtn" href={taskDetailPath(t, selectedBatchId, taskPage)}>查看详情</Link></span>
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
