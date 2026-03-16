"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch } from "../../../lib/api";
import { TaskDetail } from "../../../lib/types";

export default function TaskDetailPage() {
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
    let timer: ReturnType<typeof setInterval> | null = null;

    const tick = () => {
      if (document.hidden) return;
      void loadDetailSilently();
    };

    timer = setInterval(tick, intervalMs);
    return () => {
      if (timer) clearInterval(timer);
    };
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
      router.push("/tasks");
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
          <h1>任务详情 #{taskId}</h1>
          <p>查看 OCR、匹配、改写、推荐正文、标签及最终输出</p>
        </div>
        <div className="actions">
          <Link className="linkBtn" href="/tasks">返回任务列表</Link>
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
              <div><strong>目录</strong><p>{detail.folder_name}</p></div>
              <div><strong>书稿ID</strong><p>{detail.book_id}</p></div>
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
              <label>改写正文</label>
              <textarea readOnly rows={6} value={detail.rewritten_note || ""} />
              <label>推荐正文</label>
              <textarea readOnly rows={4} value={detail.intro_text || ""} />
              <label>固定标签</label>
              <input readOnly value={detail.fixed_tags_text || ""} />
              <label>随机标签</label>
              <input readOnly value={detail.random_tags_text || ""} />
              <label>最终汇总文本</label>
              <textarea readOnly rows={8} value={detail.full_output || ""} />
              <button onClick={() => navigator.clipboard.writeText(detail.full_output || "")}>复制最终文本</button>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
