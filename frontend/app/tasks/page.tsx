"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../../lib/api";
import { Book, Task, TaskCreateResponse } from "../../lib/types";

function extractFolderName(file: File): string {
  const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || "";
  const normalized = rel.replaceAll("\\", "/");
  if (normalized.includes("/")) return normalized.split("/")[0];
  return "default";
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [autoRefreshError, setAutoRefreshError] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const [taskFiles, setTaskFiles] = useState<File[]>([]);
  const [batchName, setBatchName] = useState("batch");
  const [folderBindings, setFolderBindings] = useState<Record<string, number>>({});
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  const folderNames = useMemo(() => {
    const set = new Set<string>();
    for (const f of taskFiles) set.add(extractFolderName(f));
    return Array.from(set).sort();
  }, [taskFiles]);

  const folderFileCount = useMemo(() => {
    const countMap: Record<string, number> = {};
    for (const f of taskFiles) {
      const folder = extractFolderName(f);
      countMap[folder] = (countMap[folder] || 0) + 1;
    }
    return countMap;
  }, [taskFiles]);

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const [taskData, bookData] = await Promise.all([
        apiFetch<Task[]>("/tasks"),
        apiFetch<Book[]>("/books")
      ]);
      setTasks(taskData);
      setBooks(bookData);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function loadDataSilently() {
    try {
      const [taskData, bookData] = await Promise.all([
        apiFetch<Task[]>("/tasks"),
        apiFetch<Book[]>("/books")
      ]);
      setTasks(taskData);
      setBooks(bookData);
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
    let timer: ReturnType<typeof setInterval> | null = null;

    const tick = () => {
      if (document.hidden) return;
      void loadDataSilently();
    };

    timer = setInterval(tick, intervalMs);
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [tasks]);

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

  async function onCreateTask(e: FormEvent) {
    e.preventDefault();
    if (taskFiles.length === 0 || folderNames.length === 0) {
      setError("请先上传目录");
      return;
    }
    for (const folder of folderNames) {
      if (!folderBindings[folder]) {
        setError(`目录 ${folder} 未绑定书稿`);
        return;
      }
    }

    setLoading(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append(
        "bindings",
        JSON.stringify(folderNames.map((folder) => ({ folder_name: folder, book_id: folderBindings[folder] })))
      );
      fd.append("batch_name", batchName || "batch");
      fd.append("auto_enqueue", "true");

      for (const file of taskFiles) {
        const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
        fd.append("files", file, rel);
      }
      await apiFetch<TaskCreateResponse>("/tasks", { method: "POST", body: fd });

      setTaskFiles([]);
      setFolderBindings({});
      setBatchName("batch");
      setIsCreateOpen(false);
      await loadData();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function appendDirectoryFiles(nextFiles: File[]) {
    if (nextFiles.length === 0) return;
    setTaskFiles((prev) => {
      const map = new Map<string, File>();
      for (const f of prev) {
        const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
        map.set(rel, f);
      }
      for (const f of nextFiles) {
        const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
        map.set(rel, f);
      }
      return Array.from(map.values());
    });
  }

  function onChooseDirectory() {
    folderInputRef.current?.click();
  }

  function removeFolder(folder: string) {
    setTaskFiles((prev) => prev.filter((f) => extractFolderName(f) !== folder));
    setFolderBindings((prev) => {
      const next = { ...prev };
      delete next[folder];
      return next;
    });
  }

  return (
    <div className="pageWrap">
      <header className="pageHeader rowHeader">
        <div>
          <h1>任务列表</h1>
          <p>创建任务、查看状态、进入任务详情、失败任务重试</p>
        </div>
        <div className="actions">
          <button onClick={() => setIsCreateOpen(true)}>创建任务</button>
          <button onClick={() => void loadData()} disabled={loading}>刷新</button>
        </div>
      </header>

      {error ? <div className="errorBox">{error}</div> : null}
      {autoRefreshError ? <div className="errorBox">{autoRefreshError}</div> : null}

      <section className="card">
        <div className="table">
          <div className="thead">
            <span>ID</span>
            <span>目录名</span>
            <span>书稿ID</span>
            <span>状态</span>
            <span>创建时间</span>
            <span>操作</span>
          </div>
          {tasks.map((t) => (
            <div key={t.id} className="trow">
              <span>{t.id}</span>
              <span>{t.folder_name}</span>
              <span>{t.book_id}</span>
              <span>{t.status}</span>
              <span>{new Date(t.created_at).toLocaleString()}</span>
              <span className="actions">
                <Link className="linkBtn" href={`/tasks/${t.id}`}>详情</Link>
                <button onClick={() => void onRetry(t.id, t.status)} disabled={loading}>重试</button>
                <button onClick={() => void onDelete(t.id)} disabled={loading || t.status === "processing"}>删除</button>
              </span>
            </div>
          ))}
          {tasks.length === 0 ? <p className="empty">暂无任务</p> : null}
        </div>
      </section>

      {isCreateOpen ? (
        <div className="modalMask" onClick={() => setIsCreateOpen(false)}>
          <div className="modalCard" onClick={(e) => e.stopPropagation()}>
            <div className="rowHeader">
              <h2>创建任务</h2>
              <button onClick={() => setIsCreateOpen(false)}>关闭</button>
            </div>
            <form onSubmit={onCreateTask} className="stack">
              <input
                ref={folderInputRef}
                type="file"
                multiple
                style={{ display: "none" }}
                {...({ webkitdirectory: "true", directory: "true" } as Record<string, string>)}
                onChange={(e) => {
                  appendDirectoryFiles(Array.from(e.target.files || []));
                  e.currentTarget.value = "";
                }}
              />
              <div className="actions">
                <button type="button" onClick={onChooseDirectory} disabled={loading}>选择并追加目录</button>
              </div>
              {folderNames.length > 0 ? (
                <div className="stack">
                  {folderNames.map((folder) => (
                    <div key={folder} className="bindRow">
                      <span>{folder}（{folderFileCount[folder] || 0} 张）</span>
                      <button type="button" onClick={() => removeFolder(folder)} disabled={loading}>移除目录</button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="empty">暂未选择目录</p>
              )}
              <input value={batchName} onChange={(e) => setBatchName(e.target.value)} placeholder="批次名（多目录时生效）" />
              {folderNames.map((folder) => (
                <div key={folder} className="bindRow">
                  <span>{folder}</span>
                  <select
                    value={folderBindings[folder] || ""}
                    onChange={(e) =>
                      setFolderBindings((prev) => ({ ...prev, [folder]: Number(e.target.value) }))
                    }
                  >
                    <option value="">选择书稿</option>
                    {books.map((book) => (
                      <option key={book.id} value={book.id}>
                        {book.id} - {book.title}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
              <button type="submit" disabled={loading}>提交任务</button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
