"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../../lib/api";
import { formatBeijingDateTime } from "../../../lib/time";
import { Task, TaskDetail } from "../../../lib/types";

export default function FrameworkTaskDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const taskId = Number(params.id);

  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [autoRefreshError, setAutoRefreshError] = useState("");
  const [toast, setToast] = useState("");
  const [taskIds, setTaskIds] = useState<number[]>([]);
  const [editedFullOutput, setEditedFullOutput] = useState("");

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 1800);
  }

  async function copyText(text: string) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const el = document.createElement("textarea");
        el.value = text;
        el.style.position = "fixed";
        el.style.opacity = "0";
        document.body.appendChild(el);
        el.focus();
        el.select();
        document.execCommand("copy");
        document.body.removeChild(el);
      }
      showToast("复制成功");
    } catch {
      showToast("复制失败");
    }
  }

  async function loadDetail() {
    if (!taskId) return;
    setLoading(true);
    setError("");
    try {
      const [data, list] = await Promise.all([
        apiFetch<TaskDetail>(`/tasks/${taskId}`),
        apiFetch<Task[]>("/tasks?task_type=framework"),
      ]);
      if (data.task_type !== "framework") {
        setError("该任务不是原创创作（框架）任务。");
        setDetail(null);
        return;
      }
      setDetail(data);
      setEditedFullOutput(data.full_output || "");
      setTaskIds(list.map((t) => t.id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function loadDetailSilently() {
    if (!taskId) return;
    try {
      const [data, list] = await Promise.all([
        apiFetch<TaskDetail>(`/tasks/${taskId}`),
        apiFetch<Task[]>("/tasks?task_type=framework"),
      ]);
      if (data.task_type !== "framework") return;
      setDetail(data);
      setEditedFullOutput(data.full_output || "");
      setTaskIds(list.map((t) => t.id));
      setAutoRefreshError("");
    } catch (e) {
      setAutoRefreshError(`自动刷新失败：${(e as Error).message}`);
    }
  }

  const currentIndex = useMemo(() => taskIds.findIndex((id) => id === taskId), [taskIds, taskId]);
  const prevTaskId = currentIndex > 0 ? taskIds[currentIndex - 1] : null;
  const nextTaskId = currentIndex >= 0 && currentIndex < taskIds.length - 1 ? taskIds[currentIndex + 1] : null;

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
      router.push("/framework-tasks");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function onSaveFullOutput() {
    setLoading(true);
    setError("");
    try {
      const updated = await apiFetch<TaskDetail>(`/tasks/${taskId}/full-output`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ full_output: editedFullOutput }),
      });
      setDetail(updated);
      setEditedFullOutput(updated.full_output || "");
      showToast("保存成功");
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
          <h1>框架任务详情 #{taskId}</h1>
          <p>查看 OCR、书稿匹配与最终输出</p>
        </div>
        <div className="actions">
          <Link className="linkBtn" href="/framework-tasks">返回框架任务列表</Link>
          <button onClick={() => router.push(`/framework-tasks/${prevTaskId}`)} disabled={!prevTaskId || loading}>上一篇</button>
          <button onClick={() => router.push(`/framework-tasks/${nextTaskId}`)} disabled={!nextTaskId || loading}>下一篇</button>
          <button onClick={() => void loadDetail()} disabled={loading}>刷新</button>
          <button onClick={() => void onRetry()} disabled={loading}>重试</button>
          <button onClick={() => void onDelete()} disabled={loading || detail?.status === "processing"}>删除任务</button>
        </div>
      </header>

      {error ? <div className="errorBox">{error}</div> : null}
      {autoRefreshError ? <div className="errorBox">{autoRefreshError}</div> : null}
      {toast ? <div className="toast">{toast}</div> : null}
      {!detail ? <section className="card">加载中...</section> : null}

      {detail ? (
        <>
          <section className="card">
            <h2>基础信息</h2>
            <div className="kvGrid">
              <div><strong>状态</strong><p>{detail.status}</p></div>
              <div><strong>目录</strong><p>{detail.folder_name}</p></div>
              <div><strong>书稿名称</strong><p>{detail.book_name || "-"}</p></div>
              <div><strong>提示词</strong><p>{detail.prompt_name || "-"}</p></div>
              <div><strong>标题</strong><p>{detail.extracted_title || "-"}</p></div>
              <div><strong>分点观点</strong><p style={{ whiteSpace: "pre-wrap" }}>{detail.extracted_points_text || "-"}</p></div>
              <div><strong>本次模型</strong><p>{detail.llm_model || "-"}</p></div>
              <div><strong>创建时间（北京时间）</strong><p>{formatBeijingDateTime(detail.created_at)}</p></div>
              <div><strong>重试次数</strong><p>{detail.retry_count}</p></div>
            </div>
          </section>

          <section className="card">
            <h2>OCR 原文</h2>
            <textarea readOnly rows={6} value={detail.original_note_text || ""} />
          </section>

          <section className="card">
            <h2>书稿匹配</h2>
            <p>关键词：{(detail.matched_book_segments?.keywords || []).join("，") || "-"}</p>
            {(detail.matched_book_segments?.top_segments || []).map((seg) => (
              <div key={`${seg.segment_index}-${seg.score}`} className="segmentCard">
                <p><strong>片段 {seg.segment_index}</strong> · score {seg.score.toFixed(3)}</p>
                <p>{seg.content}</p>
              </div>
            ))}
          </section>

          <section className="card">
            <h2>AI 结果</h2>
            <div className="stack">
              <label>最终文本</label>
              <textarea rows={8} value={editedFullOutput} onChange={(e) => setEditedFullOutput(e.target.value)} />
              <div className="actions">
                <button onClick={() => void onSaveFullOutput()} disabled={loading}>保存</button>
                <button onClick={() => void copyText(editedFullOutput)}>复制正文</button>
              </div>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
