"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, apiFetchResponse } from "../../../lib/api";
import { Task, TaskDetail } from "../../../lib/types";
import { formatBeijingDateTime } from "../../../lib/time";

export default function CreateTaskDetailPage() {
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
  const [isDirty, setIsDirty] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const dirtyRef = useRef(false);
  const editingRef = useRef(false);

  useEffect(() => {
    dirtyRef.current = isDirty;
  }, [isDirty]);

  useEffect(() => {
    editingRef.current = isEditing;
  }, [isEditing]);

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

  function getDownloadFilename(resp: Response, fallback: string): string {
    const disposition = resp.headers.get("content-disposition") || "";
    const mStar = disposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
    if (mStar?.[1]) {
      const raw = mStar[1].trim().replace(/^"|"$/g, "");
      try {
        return decodeURIComponent(raw);
      } catch {
        return raw;
      }
    }
    const m = disposition.match(/filename="?([^"]+)"?/i);
    return m?.[1]?.trim() || fallback;
  }

  async function downloadCurrentTask() {
    setLoading(true);
    setError("");
    try {
      if (dirtyRef.current) {
        const updated = await apiFetch<TaskDetail>(`/tasks/${taskId}/full-output`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ full_output: editedFullOutput }),
        });
        setDetail(updated);
        setEditedFullOutput(updated.full_output || "");
        setIsDirty(false);
        showToast("已自动保存后下载");
      }
      const resp = await apiFetchResponse(`/tasks/${taskId}/download`);
      const blob = await resp.blob();
      const name = getDownloadFilename(resp, `create_task_${taskId}.txt`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      await loadDetailSilently();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function loadDetail() {
    if (!taskId) return;
    setLoading(true);
    setError("");
    try {
      const [data, list] = await Promise.all([
        apiFetch<TaskDetail>(`/tasks/${taskId}`),
        apiFetch<Task[]>("/tasks?task_type=create")
      ]);
      if (data.task_type !== "create") {
        setError("该任务不是原创创作任务。");
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
        apiFetch<Task[]>("/tasks?task_type=create")
      ]);
      if (data.task_type !== "create") return;
      setDetail(data);
      if (!dirtyRef.current && !editingRef.current) {
        setEditedFullOutput(data.full_output || "");
      }
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
      if (dirtyRef.current || editingRef.current) return;
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
      setIsDirty(false);
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
          <h1>原创任务详情 #{taskId}</h1>
          <p>查看标题、原创正文及执行信息</p>
        </div>
        <div className="actions">
          <Link className="linkBtn" href="/create-tasks">返回原创任务列表</Link>
          <button onClick={() => router.push(`/create-tasks/${prevTaskId}`)} disabled={!prevTaskId || loading}>上一篇</button>
          <button onClick={() => router.push(`/create-tasks/${nextTaskId}`)} disabled={!nextTaskId || loading}>下一篇</button>
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
              <div><strong>标题</strong><p>{detail.title || "-"}</p></div>
              <div><strong>书稿ID</strong><p>{detail.book_id ?? "-"}</p></div>
              <div><strong>提示词</strong><p>{detail.prompt_name || "-"}</p></div>
              <div><strong>提示词ID</strong><p>{detail.prompt_id ?? "-"}</p></div>
              <div><strong>本次模型</strong><p>{detail.llm_model || "-"}</p></div>
              <div><strong>创建时间（北京时间）</strong><p>{formatBeijingDateTime(detail.created_at)}</p></div>
              <div><strong>重试次数</strong><p>{detail.retry_count}</p></div>
            </div>
          </section>

          <section className="card">
            <h2>AI 原创正文</h2>
            <textarea
              rows={14}
              value={editedFullOutput}
              onFocus={() => setIsEditing(true)}
              onBlur={() => setIsEditing(false)}
              onChange={(e) => {
                setEditedFullOutput(e.target.value);
                setIsDirty(true);
              }}
            />
            <div className="actions">
              <button onClick={() => void onSaveFullOutput()} disabled={loading}>保存</button>
              <button onClick={() => void copyText(editedFullOutput)}>复制正文</button>
              <button onClick={() => void downloadCurrentTask()} disabled={loading || !editedFullOutput.trim()}>
                {detail.download_count > 0 ? "重新下载" : "下载"}
              </button>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
