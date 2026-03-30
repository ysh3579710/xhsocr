"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../lib/api";
import { Book, PromptItem, Task, TaskCreateResponse } from "../../lib/types";
import { formatBeijingDateTime } from "../../lib/time";

function parseTitles(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export default function CreateTasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [books, setBooks] = useState<Book[]>([]);
  const [prompts, setPrompts] = useState<PromptItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [autoRefreshError, setAutoRefreshError] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const [titlesText, setTitlesText] = useState("");
  const [batchName, setBatchName] = useState("batch");
  const [bookId, setBookId] = useState<number | "">("");
  const [promptId, setPromptId] = useState<number | "">("");

  const titleCount = useMemo(() => parseTitles(titlesText).length, [titlesText]);
  const bookTitleById = useMemo(() => {
    const map = new Map<number, string>();
    for (const b of books) map.set(b.id, b.title);
    return map;
  }, [books]);

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const [taskData, bookData] = await Promise.all([
        apiFetch<Task[]>("/tasks?task_type=create"),
        apiFetch<Book[]>("/books")
      ]);
      setTasks(taskData);
      setBooks(bookData);
      const promptData = await apiFetch<PromptItem[]>("/prompts?enabled=true");
      setPrompts(promptData);
      if (promptData.length > 0) {
        const recentPrompt = taskData.find((t) => t.task_type === "create" && t.prompt_id && promptData.some((p) => p.id === t.prompt_id))
          ?.prompt_id;
        setPromptId(recentPrompt || promptData[0].id);
      } else {
        setPromptId("");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function loadDataSilently() {
    try {
      const [taskData, bookData] = await Promise.all([
        apiFetch<Task[]>("/tasks?task_type=create"),
        apiFetch<Book[]>("/books")
      ]);
      setTasks(taskData);
      setBooks(bookData);
      const promptData = await apiFetch<PromptItem[]>("/prompts?enabled=true");
      setPrompts(promptData);
      if (promptData.length > 0 && (promptId === "" || !promptData.some((p) => p.id === promptId))) {
        const recentPrompt = taskData.find((t) => t.task_type === "create" && t.prompt_id && promptData.some((p) => p.id === t.prompt_id))
          ?.prompt_id;
        setPromptId(recentPrompt || promptData[0].id);
      }
      setAutoRefreshError("");
    } catch (e) {
      setAutoRefreshError(`自动刷新失败：${(e as Error).message}`);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  useEffect(() => {
    const hasPending = tasks.some((t) => t.status === "waiting" || t.status === "processing");
    const intervalMs = hasPending ? 3000 : 15000;
    const tick = () => {
      if (document.hidden) return;
      void loadDataSilently();
    };
    const timer = setInterval(tick, intervalMs);
    return () => clearInterval(timer);
  }, [tasks]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    const titles = parseTitles(titlesText);
    if (titles.length === 0) {
      setError("请至少输入一个标题。");
      return;
    }
    if (!promptId) {
      setError("请选择提示词。");
      return;
    }

    setLoading(true);
    setError("");
    try {
      await apiFetch<TaskCreateResponse>("/tasks/create-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          titles,
          prompt_id: Number(promptId),
          book_id: bookId === "" ? null : Number(bookId),
          batch_name: batchName || "batch",
          auto_enqueue: true
        })
      });
      setTitlesText("");
      setBatchName("batch");
      setBookId("");
      if (prompts.length > 0) {
        const recentPrompt = tasks.find((t) => t.task_type === "create" && t.prompt_id && prompts.some((p) => p.id === t.prompt_id))
          ?.prompt_id;
        setPromptId(recentPrompt || prompts[0].id);
      } else {
        setPromptId("");
      }
      setIsCreateOpen(false);
      await loadData();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function onRetry(taskId: number, currentStatus: string) {
    setLoading(true);
    setError("");
    try {
      let url = `/tasks/${taskId}/retry`;
      if (currentStatus === "success") {
        const ok = window.confirm("当前任务已执行完成，确认要重新执行？");
        if (!ok) {
          setLoading(false);
          return;
        }
      }
      if (currentStatus === "processing") {
        const ok = window.confirm("当前任务状态是 processing，可能已卡住。是否执行强制重试？");
        if (!ok) {
          setLoading(false);
          return;
        }
        url = `${url}?force=true`;
      }
      await apiFetch(url, { method: "POST" });
      await loadData();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function onDelete(taskId: number) {
    const ok = window.confirm(`确认删除任务 #${taskId} 吗？`);
    if (!ok) return;
    setLoading(true);
    setError("");
    try {
      await apiFetch(`/tasks/${taskId}`, { method: "DELETE" });
      await loadData();
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
          <h1>原创创作</h1>
          <p>输入标题创建原创任务，支持批量一行一个标题</p>
        </div>
        <div className="actions">
          <button onClick={() => setIsCreateOpen(true)}>新建原创任务</button>
          <button onClick={() => void loadData()} disabled={loading}>刷新</button>
        </div>
      </header>

      {error ? <div className="errorBox">{error}</div> : null}
      {autoRefreshError ? <div className="errorBox">{autoRefreshError}</div> : null}

      <section className="card">
        <div className="table">
          <div className="thead trow7">
            <span>ID</span>
            <span>标题</span>
            <span>书稿名称</span>
            <span>提示词</span>
            <span>状态</span>
            <span>创建时间</span>
            <span>操作</span>
          </div>
          {tasks.map((t) => (
            <div key={t.id} className="trow trow7">
              <span>{t.id}</span>
              <span>{t.title || "-"}</span>
              <span>{t.book_id ? (bookTitleById.get(t.book_id) || `ID:${t.book_id}`) : "-"}</span>
              <span>{t.prompt_name || (t.prompt_id ? `ID:${t.prompt_id}` : "-")}</span>
              <span>{t.status}</span>
              <span>{formatBeijingDateTime(t.created_at)}</span>
              <span className="actions">
                <Link className="linkBtn" href={`/create-tasks/${t.id}`}>详情</Link>
                <button onClick={() => void onRetry(t.id, t.status)} disabled={loading}>重试</button>
                <button onClick={() => void onDelete(t.id)} disabled={loading || t.status === "processing"}>删除</button>
              </span>
            </div>
          ))}
          {tasks.length === 0 ? <p className="empty">暂无原创任务</p> : null}
        </div>
      </section>

      {isCreateOpen ? (
        <div className="modalMask">
          <div className="modalCard" onClick={(e) => e.stopPropagation()}>
            <div className="rowHeader">
              <h2>新建原创任务</h2>
              <button onClick={() => setIsCreateOpen(false)}>关闭</button>
            </div>
            <form onSubmit={onCreate} className="stack">
              <textarea
                rows={8}
                value={titlesText}
                onChange={(e) => setTitlesText(e.target.value)}
                placeholder={"一行一个标题，例如：\n怎么让学生喜欢上你的课\n公开课怎么磨课才不慌"}
              />
              <p className="empty">标题数量：{titleCount}</p>
              <input value={batchName} onChange={(e) => setBatchName(e.target.value)} placeholder="批次名（多标题时生效）" />
              <select value={promptId} onChange={(e) => setPromptId(e.target.value ? Number(e.target.value) : "")}>
                <option value="">选择提示词（必选）</option>
                {prompts.map((p) => (
                  <option key={p.id} value={p.id}>
                    [{p.track}] {p.name}
                  </option>
                ))}
              </select>
              <select value={bookId} onChange={(e) => setBookId(e.target.value ? Number(e.target.value) : "")}>
                <option value="">不绑定书稿（可选）</option>
                {books.map((book) => (
                  <option key={book.id} value={book.id}>
                    {book.id} - {book.title}
                  </option>
                ))}
              </select>
              <button type="submit" disabled={loading}>提交任务</button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
