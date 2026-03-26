"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch } from "../../../lib/api";
import { TaskDetail } from "../../../lib/types";
import { formatBeijingDateTime } from "../../../lib/time";

export default function CreateTaskDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const taskId = Number(params.id);
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [autoRefreshError, setAutoRefreshError] = useState("");

  async function loadDetail() {
    if (!taskId) return;
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch<TaskDetail>(`/tasks/${taskId}`);
      if (data.task_type !== "create") {
        setError("该任务不是原创创作任务。");
        setDetail(null);
        return;
      }
      setDetail(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function loadDetailSilently() {
    if (!taskId) return;
    try {
      const data = await apiFetch<TaskDetail>(`/tasks/${taskId}`);
      if (data.task_type !== "create") return;
      setDetail(data);
      setAutoRefreshError("");
    } catch (e) {
      setAutoRefreshError(`自动刷新失败：${(e as Error).message}`);
    }
  }

  useEffect(() => {
    void loadDetail();
  }, [taskId]);

  useEffect(() => {
    const status = detail?.status;
    const intervalMs = status === "waiting" || status === "processing" ? 3000 : 15000;
    const tick = () => {
      if (document.hidden) return;
      void loadDetailSilently();
    };
    const timer = setInterval(tick, intervalMs);
    return () => clearInterval(timer);
  }, [detail?.status, taskId]);

  async function onRetry() {
    setLoading(true);
    setError("");
    try {
      let url = `/tasks/${taskId}/retry`;
      if (detail?.status === "success") {
        const ok = window.confirm("当前任务已执行完成，确认要重新执行？");
        if (!ok) {
          setLoading(false);
          return;
        }
      }
      if (detail?.status === "processing") {
        const ok = window.confirm("当前任务状态是 processing，可能已卡住。是否执行强制重试？");
        if (!ok) {
          setLoading(false);
          return;
        }
        url = `${url}?force=true`;
      }
      await apiFetch(url, { method: "POST" });
      await loadDetail();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function onDelete() {
    const ok = window.confirm(`确认删除任务 #${taskId} 吗？`);
    if (!ok) return;
    setLoading(true);
    setError("");
    try {
      await apiFetch(`/tasks/${taskId}`, { method: "DELETE" });
      router.push("/create-tasks");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="pageWrap">
      <header className="pageHeader rowHeader">
        <div>
          <h1>原创任务详情 #{taskId}</h1>
          <p>查看标题、原创正文及执行信息</p>
        </div>
        <div className="actions">
          <Link className="linkBtn" href="/create-tasks">返回原创任务列表</Link>
          <button onClick={() => void loadDetail()} disabled={loading}>刷新</button>
          <button onClick={() => void onRetry()} disabled={loading}>重试</button>
          <button onClick={() => void onDelete()} disabled={loading || detail?.status === "processing"}>删除任务</button>
        </div>
      </header>

      {error ? <div className="errorBox">{error}</div> : null}
      {autoRefreshError ? <div className="errorBox">{autoRefreshError}</div> : null}
      {!detail ? <section className="card">加载中...</section> : null}

      {detail ? (
        <>
          <section className="card">
            <h2>基础信息</h2>
            <div className="kvGrid">
              <div><strong>状态</strong><p>{detail.status}</p></div>
              <div><strong>标题</strong><p>{detail.title || "-"}</p></div>
              <div><strong>书稿ID</strong><p>{detail.book_id ?? "-"}</p></div>
              <div><strong>本次模型</strong><p>{detail.llm_model || "-"}</p></div>
              <div><strong>创建时间（北京时间）</strong><p>{formatBeijingDateTime(detail.created_at)}</p></div>
              <div><strong>重试次数</strong><p>{detail.retry_count}</p></div>
            </div>
          </section>

          <section className="card">
            <h2>AI 原创正文</h2>
            <textarea readOnly rows={14} value={detail.rewritten_note || detail.full_output || ""} />
            <button onClick={() => navigator.clipboard.writeText(detail.rewritten_note || detail.full_output || "")}>
              复制正文
            </button>
          </section>
        </>
      ) : null}
    </div>
  );
}
