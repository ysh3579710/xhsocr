"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import ArticleReadView, { ArticleColumnMode } from "../../../components/ArticleReadView";
import { apiFetch, apiFetchResponse } from "../../../lib/api";
import { formatBeijingDateTime } from "../../../lib/time";
import { TaskDetail, TaskNeighbors } from "../../../lib/types";

export default function FrameworkTaskDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const taskId = Number(params.id);

  const getBatchParams = () => {
    if (typeof window === "undefined") return { batchId: null, taskPage: null };
    const searchParams = new URLSearchParams(window.location.search);
    return {
      batchId: searchParams.get("batch_id"),
      taskPage: searchParams.get("task_page"),
    };
  };

  const { batchId, taskPage } = getBatchParams();
  const batchQuery = batchId ? `?batch_id=${encodeURIComponent(batchId)}` : "";
  const batchReturnQuery = batchId ? `${batchQuery}${taskPage ? `&task_page=${encodeURIComponent(taskPage)}` : ""}` : "";

  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [autoRefreshError, setAutoRefreshError] = useState("");
  const [toast, setToast] = useState("");
  const [prevTaskId, setPrevTaskId] = useState<number | null>(null);
  const [nextTaskId, setNextTaskId] = useState<number | null>(null);
  const [editedFullOutput, setEditedFullOutput] = useState("");
  const [columnMode, setColumnMode] = useState<ArticleColumnMode>("auto");
  const [showBasicInfo, setShowBasicInfo] = useState(false);
  const [showDetailBlocks, setShowDetailBlocks] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const dirtyRef = useRef(false);
  const editingRef = useRef(false);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    dirtyRef.current = isDirty;
  }, [isDirty]);

  useEffect(() => {
    editingRef.current = isEditing;
  }, [isEditing]);

  useEffect(() => {
    if (!isEditing || !editorRef.current) return;
    const el = editorRef.current;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [editedFullOutput, isEditing]);

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
      const name = getDownloadFilename(resp, `framework_task_${taskId}.txt`);
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
      const [data, neighbors] = await Promise.all([
        apiFetch<TaskDetail>(`/tasks/${taskId}`),
        apiFetch<TaskNeighbors>(`/tasks/${taskId}/neighbors${batchQuery}`),
      ]);
      if (data.task_type !== "framework") {
        setError("该任务不是原创创作（框架）任务。");
        setDetail(null);
        return;
      }
      setDetail(data);
      setEditedFullOutput(data.full_output || "");
      setPrevTaskId(neighbors.prev_task_id);
      setNextTaskId(neighbors.next_task_id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function loadDetailSilently() {
    if (!taskId) return;
    try {
      const [data, neighbors] = await Promise.all([
        apiFetch<TaskDetail>(`/tasks/${taskId}`),
        apiFetch<TaskNeighbors>(`/tasks/${taskId}/neighbors${batchQuery}`),
      ]);
      if (data.task_type !== "framework") return;
      setDetail(data);
      if (!dirtyRef.current && !editingRef.current) {
        setEditedFullOutput(data.full_output || "");
      }
      setPrevTaskId(neighbors.prev_task_id);
      setNextTaskId(neighbors.next_task_id);
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
      setIsDirty(false);
      setIsEditing(false);
      showToast("保存成功");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function onCancelEditing() {
    setEditedFullOutput(detail?.full_output || "");
    setIsDirty(false);
    setIsEditing(false);
  }

  async function onToggleFeatured() {
    if (!detail || detail.status !== "success") return;
    setLoading(true);
    setError("");
    try {
      await apiFetch(`/tasks/${taskId}/feature`, {
        method: detail.is_featured ? "DELETE" : "POST",
      });
      await loadDetail();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="pageWrap pageWrapWide">
      <header className="pageHeader rowHeader">
        <div>
          <h1>框架任务详情 #{taskId}</h1>
          <p>查看 OCR、书稿匹配与最终输出</p>
        </div>
        <div className="actions">
          <Link className="linkBtn" href={batchReturnQuery ? `/batches${batchReturnQuery}` : "/framework-tasks"}>返回框架任务列表</Link>
          <button onClick={() => router.push(`/framework-tasks/${prevTaskId}${batchQuery}`)} disabled={!prevTaskId || loading}>上一篇</button>
          <button onClick={() => router.push(`/framework-tasks/${nextTaskId}${batchQuery}`)} disabled={!nextTaskId || loading}>下一篇</button>
          <button onClick={() => void loadDetail()} disabled={loading}>刷新</button>
          {detail?.status === "success" ? (
            <button onClick={() => void onToggleFeatured()} disabled={loading}>
              {detail.is_featured ? "已精选" : "精选"}
            </button>
          ) : null}
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
            <div className="sectionHeaderRow">
              <h2>基础信息</h2>
              <button type="button" className="linkBtn" onClick={() => setShowBasicInfo((prev) => !prev)}>
                {showBasicInfo ? "收起基础信息" : "展开基础信息"}
              </button>
            </div>
            {showBasicInfo ? (
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
            ) : (
              <p className="collapsedSummary">
                状态：{detail.status}　目录：{detail.folder_name || "-"}　标题：{detail.extracted_title || "-"}　本次模型：{detail.llm_model || "-"}
              </p>
            )}
          </section>

          <section className="card">
            <div className="sectionHeaderRow">
              <h2>AI 结果</h2>
              <div className="actions">
                {isEditing ? (
                  <button type="button" className="linkBtn" onClick={onCancelEditing}>
                    取消编辑
                  </button>
                ) : (
                  <button type="button" className="linkBtn" onClick={() => setIsEditing(true)}>
                    编辑正文
                  </button>
                )}
                <button type="button" className="linkBtn" onClick={() => setShowDetailBlocks((prev) => !prev)}>
                  {showDetailBlocks ? "收起详情" : "展开详情"}
                </button>
              </div>
            </div>
            <div className="stack">
              <label>最终文本</label>
              {isEditing ? (
                <textarea
                  ref={editorRef}
                  className="editorArea"
                  value={editedFullOutput}
                  onChange={(e) => {
                    setEditedFullOutput(e.target.value);
                    setIsDirty(true);
                  }}
                />
              ) : (
                <ArticleReadView text={editedFullOutput} mode={columnMode} onModeChange={setColumnMode} />
              )}
              <div className="actions">
                <button onClick={() => void onSaveFullOutput()} disabled={loading || !isDirty}>保存</button>
                <button onClick={() => void copyText(editedFullOutput)}>复制正文</button>
                <button onClick={() => void downloadCurrentTask()} disabled={loading || !editedFullOutput.trim()}>
                  {detail.download_count > 0 ? "重新下载" : "下载"}
                </button>
              </div>
            </div>
          </section>

          {showDetailBlocks ? (
            <>
              <section className="card">
                <h2>清洗前原始输出</h2>
                <textarea readOnly rows={8} value={detail.raw_output || ""} />
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
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
