"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../lib/api";
import { formatBeijingDateTime } from "../../lib/time";
import { FeaturedNote } from "../../lib/types";

function sourceTypeLabel(note: FeaturedNote) {
  if (note.is_manual) return "手动创建";
  if (note.source_task_type === "ocr") return "仿写任务";
  if (note.source_task_type === "create") return "原创创作";
  if (note.source_task_type === "framework") return "原创创作（框架）";
  return "未知来源";
}

export default function FeaturedNotesPage() {
  const [notes, setNotes] = useState<FeaturedNote[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [manualContent, setManualContent] = useState("");
  const [keyword, setKeyword] = useState("");

  const filteredNotes = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter((note) => note.title.toLowerCase().includes(q));
  }, [notes, keyword]);

  async function loadNotes() {
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch<FeaturedNote[]>("/featured-notes");
      setNotes(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadNotes();
  }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!manualContent.trim()) {
      setError("请输入精选内容。");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await apiFetch<FeaturedNote>("/featured-notes/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: manualContent }),
      });
      setManualContent("");
      setIsCreateOpen(false);
      await loadNotes();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function onDelete(noteId: number) {
    const ok = window.confirm(`确认删除精选笔记 #${noteId} 吗？`);
    if (!ok) return;
    setLoading(true);
    setError("");
    try {
      await apiFetch(`/featured-notes/${noteId}`, { method: "DELETE" });
      await loadNotes();
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
          <h1>精选笔记</h1>
          <p>沉淀优质文本，支持手动录入、查看详情与后续二次创作</p>
        </div>
        <div className="actions">
          <button onClick={() => setIsCreateOpen(true)} disabled={loading}>新建精选笔记</button>
          <button onClick={() => void loadNotes()} disabled={loading}>刷新</button>
        </div>
      </header>

      {error ? <div className="errorBox">{error}</div> : null}

      <section className="card">
        <h2>标题搜索</h2>
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="按标题关键字筛选"
        />
      </section>

      <section className="card">
        <h2>精选列表</h2>
        <div className="table">
          <div className="thead trow5">
            <span>ID</span>
            <span>来源</span>
            <span>标题</span>
            <span>创建时间</span>
            <span>操作</span>
          </div>
          {filteredNotes.map((note) => (
            <div key={note.id} className="trow trow5">
              <span>{note.id}</span>
              <span>{sourceTypeLabel(note)}</span>
              <span>{note.title}</span>
              <span>{formatBeijingDateTime(note.created_at)}</span>
              <span className="actions">
                <Link className="linkBtn" href={`/featured-notes/${note.id}`}>详情</Link>
                <button onClick={() => void onDelete(note.id)} disabled={loading}>删除</button>
              </span>
            </div>
          ))}
          {filteredNotes.length === 0 ? <p className="empty">暂无精选笔记</p> : null}
        </div>
      </section>

      {isCreateOpen ? (
        <div className="modalMask">
          <div className="modalCard" onClick={(e) => e.stopPropagation()}>
            <div className="rowHeader">
              <h2>新建精选笔记</h2>
              <button onClick={() => setIsCreateOpen(false)} disabled={loading}>关闭</button>
            </div>
            <form onSubmit={onCreate} className="stack">
              <textarea
                rows={14}
                value={manualContent}
                onChange={(e) => setManualContent(e.target.value)}
                placeholder={"第一行作为标题，其余内容作为正文\n例如：\n怎么让学生喜欢上你的课\n正文第一段\n正文第二段"}
              />
              <button type="submit" disabled={loading}>创建精选笔记</button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
