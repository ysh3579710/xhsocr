"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../../lib/api";
import { formatBeijingDateTime } from "../../../lib/time";
import { Book, FeaturedNote, PromptItem, TaskCreateResponse } from "../../../lib/types";

function sourceTypeLabel(note: FeaturedNote) {
  if (note.is_manual) return "手动创建";
  if (note.source_task_type === "ocr") return "仿写任务";
  if (note.source_task_type === "create") return "原创创作";
  if (note.source_task_type === "framework") return "原创创作（框架）";
  return "未知来源";
}

export default function FeaturedNoteDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const noteId = Number(params.id);

  const [detail, setDetail] = useState<FeaturedNote | null>(null);
  const [books, setBooks] = useState<Book[]>([]);
  const [prompts, setPrompts] = useState<PromptItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fullText, setFullText] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const [spawnMode, setSpawnMode] = useState<"rewrite" | "create" | "framework" | null>(null);
  const [spawnTaskName, setSpawnTaskName] = useState("");
  const [spawnTitle, setSpawnTitle] = useState("");
  const [spawnBookId, setSpawnBookId] = useState<number | "">("");
  const [spawnPromptId, setSpawnPromptId] = useState<number | "">("");

  const titlePreview = useMemo(() => {
    const normalized = fullText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    return normalized.split("\n", 1)[0] || "";
  }, [fullText]);

  async function loadDetail() {
    if (!noteId) return;
    setLoading(true);
    setError("");
    try {
      const [data, bookData, promptData] = await Promise.all([
        apiFetch<FeaturedNote>(`/featured-notes/${noteId}`),
        apiFetch<Book[]>("/books"),
        apiFetch<PromptItem[]>("/prompts?enabled=true"),
      ]);
      setDetail(data);
      setFullText(data.full_text);
      setBooks(bookData);
      setPrompts(promptData);
      setIsDirty(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDetail();
  }, [noteId]);

  async function onSave() {
    setLoading(true);
    setError("");
    try {
      const updated = await apiFetch<FeaturedNote>(`/featured-notes/${noteId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: fullText }),
      });
      setDetail(updated);
      setFullText(updated.full_text);
      setIsDirty(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function pickPromptId(kind: "rewrite" | "create" | "framework") {
    if (kind === "rewrite") {
      return prompts.find((p) => p.name.includes("仿写"))?.id || "";
    }
    if (kind === "framework") {
      return prompts.find((p) => p.name.includes("框架"))?.id || "";
    }
    return prompts.find((p) => p.name.includes("原创") && !p.name.includes("框架"))?.id || "";
  }

  function openSpawnModal(kind: "rewrite" | "create" | "framework") {
    const defaultTitle = titlePreview || detail?.title || "";
    setSpawnMode(kind);
    setSpawnPromptId(pickPromptId(kind));
    if (kind === "create") {
      setSpawnTitle(defaultTitle);
      setSpawnBookId("");
      setSpawnTaskName("");
    } else {
      setSpawnTaskName(defaultTitle || (kind === "framework" ? "任务-框架原创" : "任务-仿写"));
      setSpawnBookId("");
      setSpawnTitle("");
    }
  }

  async function ensureSavedBeforeSpawn() {
    if (!isDirty) return detail;
    const updated = await apiFetch<FeaturedNote>(`/featured-notes/${noteId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: fullText }),
    });
    setDetail(updated);
    setFullText(updated.full_text);
    setIsDirty(false);
    return updated;
  }

  async function onSpawn() {
    if (!spawnMode) return;
    setLoading(true);
    setError("");
    try {
      const saved = await ensureSavedBeforeSpawn();
      if (!saved) return;
      let targetPath = "";
      let redirectPath = "";
      let body: Record<string, unknown> = { auto_enqueue: true };

      if (spawnMode === "rewrite") {
        if (!spawnTaskName.trim()) {
          setError("请填写任务名称。");
          return;
        }
        if (!spawnBookId) {
          setError("请选择书稿。");
          return;
        }
        if (!spawnPromptId) {
          setError("请选择提示词。");
          return;
        }
        targetPath = `/featured-notes/${noteId}/spawn-rewrite`;
        redirectPath = "/tasks";
        body = {
          task_name: spawnTaskName.trim(),
          book_id: Number(spawnBookId),
          prompt_id: Number(spawnPromptId),
          auto_enqueue: true,
        };
      } else if (spawnMode === "framework") {
        if (!spawnTaskName.trim()) {
          setError("请填写任务名称。");
          return;
        }
        if (!spawnBookId) {
          setError("请选择书稿。");
          return;
        }
        if (!spawnPromptId) {
          setError("请选择提示词。");
          return;
        }
        targetPath = `/featured-notes/${noteId}/spawn-framework`;
        redirectPath = "/framework-tasks";
        body = {
          task_name: spawnTaskName.trim(),
          book_id: Number(spawnBookId),
          prompt_id: Number(spawnPromptId),
          auto_enqueue: true,
        };
      } else {
        if (!spawnTitle.trim()) {
          setError("请填写标题。");
          return;
        }
        if (!spawnPromptId) {
          setError("请选择提示词。");
          return;
        }
        targetPath = `/featured-notes/${noteId}/spawn-create`;
        redirectPath = "/create-tasks";
        body = {
          title: spawnTitle.trim(),
          book_id: spawnBookId === "" ? null : Number(spawnBookId),
          prompt_id: Number(spawnPromptId),
          auto_enqueue: true,
        };
      }

      await apiFetch<TaskCreateResponse>(targetPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setSpawnMode(null);
      router.push(redirectPath);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function onDelete() {
    const ok = window.confirm(`确认删除精选笔记 #${noteId} 吗？`);
    if (!ok) return;
    setLoading(true);
    setError("");
    try {
      await apiFetch(`/featured-notes/${noteId}`, { method: "DELETE" });
      router.push("/featured-notes");
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
          <h1>精选笔记详情 #{noteId}</h1>
          <p>查看与编辑正文，后续在这里发起二次创作</p>
        </div>
        <div className="actions">
          <Link className="linkBtn" href="/featured-notes">返回精选笔记列表</Link>
          <button onClick={() => openSpawnModal("rewrite")} disabled={loading}>二次仿写</button>
          <button onClick={() => openSpawnModal("create")} disabled={loading}>二次原创</button>
          <button onClick={() => openSpawnModal("framework")} disabled={loading}>二次框架原创</button>
          <button onClick={() => void loadDetail()} disabled={loading}>刷新</button>
          <button onClick={() => void onSave()} disabled={loading || !isDirty}>保存</button>
          <button onClick={() => void onDelete()} disabled={loading}>删除</button>
        </div>
      </header>

      {error ? <div className="errorBox">{error}</div> : null}
      {!detail ? <section className="card">加载中...</section> : null}

      {detail ? (
        <>
          <section className="card">
            <h2>基础信息</h2>
            <div className="kvGrid">
              <div>
                <strong>来源</strong>
                <p>{sourceTypeLabel(detail)}</p>
              </div>
              <div>
                <strong>来源任务</strong>
                <p>{detail.source_task_id ?? "-"}</p>
              </div>
              <div>
                <strong>标题预览</strong>
                <p>{titlePreview || "-"}</p>
              </div>
              <div>
                <strong>创建时间</strong>
                <p>{formatBeijingDateTime(detail.created_at)}</p>
              </div>
            </div>
          </section>

          <section className="card">
            <h2>正文内容</h2>
            <p className="helperText">
              可直接编辑正文并保存。这里修改的是精选笔记副本，不会影响原任务内容。
              {isDirty ? " 当前有未保存修改。" : ""}
            </p>
            <textarea
              rows={24}
              value={fullText}
              onChange={(e) => {
                setFullText(e.target.value);
                setIsDirty(true);
              }}
              placeholder="第一行作为标题，后续内容作为正文"
            />
          </section>

          {detail.structured_title || detail.structured_points_text ? (
            <section className="card">
              <h2>结构化快照</h2>
              {detail.structured_title ? (
                <div className="stack">
                  <strong>标题</strong>
                  <textarea rows={3} value={detail.structured_title} readOnly />
                </div>
              ) : null}
              {detail.structured_points_text ? (
                <div className="stack">
                  <strong>分点观点</strong>
                  <textarea rows={8} value={detail.structured_points_text} readOnly />
                </div>
              ) : null}
            </section>
          ) : null}
        </>
      ) : null}

      {spawnMode ? (
        <div className="modalMask">
          <div className="modalCard" onClick={(e) => e.stopPropagation()}>
            <div className="rowHeader">
              <h2>
                {spawnMode === "rewrite" ? "发起二次仿写" : spawnMode === "create" ? "发起二次原创" : "发起二次框架原创"}
              </h2>
              <button onClick={() => setSpawnMode(null)} disabled={loading}>关闭</button>
            </div>
            <div className="stack">
              {spawnMode === "create" ? (
                <>
                  <div className="bindRow">
                    <span>标题</span>
                    <input value={spawnTitle} onChange={(e) => setSpawnTitle(e.target.value)} placeholder="请输入标题" />
                  </div>
                  <div className="bindRow">
                    <span>提示词</span>
                    <select value={spawnPromptId} onChange={(e) => setSpawnPromptId(e.target.value ? Number(e.target.value) : "")}>
                      <option value="">选择提示词</option>
                      {prompts.map((p) => (
                        <option key={p.id} value={p.id}>[{p.track}] {p.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="bindRow">
                    <span>绑定书稿</span>
                    <select value={spawnBookId} onChange={(e) => setSpawnBookId(e.target.value ? Number(e.target.value) : "")}>
                      <option value="">不绑定书稿（可选）</option>
                      {books.map((book) => (
                        <option key={book.id} value={book.id}>{book.id} - {book.title}</option>
                      ))}
                    </select>
                  </div>
                </>
              ) : (
                <>
                  <div className="bindRow">
                    <span>任务名称</span>
                    <input value={spawnTaskName} onChange={(e) => setSpawnTaskName(e.target.value)} placeholder="请输入任务名称" />
                  </div>
                  <div className="bindRow">
                    <span>绑定书稿</span>
                    <select value={spawnBookId} onChange={(e) => setSpawnBookId(e.target.value ? Number(e.target.value) : "")}>
                      <option value="">选择书稿</option>
                      {books.map((book) => (
                        <option key={book.id} value={book.id}>{book.id} - {book.title}</option>
                      ))}
                    </select>
                  </div>
                  <div className="bindRow">
                    <span>提示词</span>
                    <select value={spawnPromptId} onChange={(e) => setSpawnPromptId(e.target.value ? Number(e.target.value) : "")}>
                      <option value="">选择提示词</option>
                      {prompts.map((p) => (
                        <option key={p.id} value={p.id}>[{p.track}] {p.name}</option>
                      ))}
                    </select>
                  </div>
                </>
              )}
              <button onClick={() => void onSpawn()} disabled={loading}>创建任务</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
