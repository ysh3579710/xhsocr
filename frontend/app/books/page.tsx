"use client";

import { FormEvent, useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import { formatBeijingDateTime } from "../../lib/time";
import { Book } from "../../lib/types";

export default function BooksPage() {
  const [books, setBooks] = useState<Book[]>([]);
  const [bookFile, setBookFile] = useState<File | null>(null);
  const [bookTitle, setBookTitle] = useState("");
  const [bookAuthor, setBookAuthor] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [editingBookId, setEditingBookId] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState("");

  async function loadBooks() {
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch<Book[]>("/books");
      setBooks(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadBooks();
  }, []);

  async function onUpload(e: FormEvent) {
    e.preventDefault();
    if (!bookFile) return;
    setLoading(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", bookFile);
      if (bookTitle.trim()) fd.append("title", bookTitle.trim());
      if (bookAuthor.trim()) fd.append("author", bookAuthor.trim());
      await apiFetch("/books/upload", { method: "POST", body: fd });
      setBookFile(null);
      setBookTitle("");
      setBookAuthor("");
      await loadBooks();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function onDelete(id: number) {
    setLoading(true);
    setError("");
    try {
      await apiFetch(`/books/${id}`, { method: "DELETE" });
      await loadBooks();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function openEdit(book: Book) {
    setEditingBookId(book.id);
    setEditingTitle(book.title);
    setError("");
  }

  async function onSaveEdit() {
    if (!editingBookId) return;
    const title = editingTitle.trim();
    if (!title) {
      setError("书名不能为空。");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await apiFetch(`/books/${editingBookId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      setEditingBookId(null);
      setEditingTitle("");
      await loadBooks();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="pageWrap">
      <header className="pageHeader">
        <h1>书库管理</h1>
        <p>上传书稿、查看切片数量、删除未被任务引用的书稿</p>
      </header>

      {error ? <div className="errorBox">{error}</div> : null}

      <section className="card">
        <h2>上传书稿</h2>
        <form onSubmit={onUpload} className="stack">
          <input type="file" accept=".docx" onChange={(e) => setBookFile(e.target.files?.[0] || null)} required />
          <input value={bookTitle} onChange={(e) => setBookTitle(e.target.value)} placeholder="书名（可选）" />
          <input value={bookAuthor} onChange={(e) => setBookAuthor(e.target.value)} placeholder="作者（可选）" />
          <button type="submit" disabled={loading}>上传书稿</button>
        </form>
      </section>

      <section className="card">
        <h2>书稿列表</h2>
        <div className="table">
          <div className="thead">
            <span>ID</span>
            <span>书名</span>
            <span>切片数</span>
            <span>创建时间</span>
            <span>操作</span>
          </div>
          {books.map((b) => (
            <div key={b.id} className="trow">
              <span>{b.id}</span>
              <span>{b.title}</span>
              <span>{b.segment_count}</span>
              <span>{formatBeijingDateTime(b.created_at)}</span>
              <span className="actions">
                <button onClick={() => openEdit(b)} disabled={loading}>编辑</button>
                <button onClick={() => void onDelete(b.id)} disabled={loading}>删除</button>
              </span>
            </div>
          ))}
          {books.length === 0 ? <p className="empty">暂无书稿</p> : null}
        </div>
      </section>

      {editingBookId ? (
        <div className="modalMask">
          <div className="modalCard" onClick={(e) => e.stopPropagation()}>
            <div className="rowHeader">
              <h2>编辑书名</h2>
              <button onClick={() => setEditingBookId(null)} disabled={loading}>关闭</button>
            </div>
            <div className="stack">
              <input
                value={editingTitle}
                onChange={(e) => setEditingTitle(e.target.value)}
                placeholder="请输入书名"
              />
              <div className="actions">
                <button onClick={() => void onSaveEdit()} disabled={loading}>保存</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
