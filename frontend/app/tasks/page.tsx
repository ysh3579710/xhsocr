"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, apiFetchResponse } from "../../lib/api";
import { formatBeijingDateTime } from "../../lib/time";
import { Book, PromptItem, Task, TaskCreateResponse } from "../../lib/types";

type CreateMode = "folder" | "paste";
type UploadFile = File & { webkitRelativePath?: string };

type PastedImage = {
  id: string;
  file: File;
  pastedAt: number;
  previewUrl: string;
};

type PastedGroup = {
  id: string;
  name: string;
  bookId?: number;
  images: PastedImage[];
};

const ALLOWED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_GROUP_IMAGES = 30;
const MAX_IMAGE_SIZE_MB = 20;
const MAX_IMAGE_BYTES = MAX_IMAGE_SIZE_MB * 1024 * 1024;

function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function extractFolderName(file: File): string {
  const rel = (file as UploadFile).webkitRelativePath || "";
  const normalized = rel.replaceAll("\\", "/");
  if (normalized.includes("/")) return normalized.split("/")[0];
  return "default";
}

function sanitizeFolderName(input: string) {
  const trimmed = input.trim();
  const safe = trimmed.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, "_");
  return safe || "group";
}

function createEmptyPasteGroup(index: number, bookId?: number): PastedGroup {
  return {
    id: createId(),
    name: `任务-${index}`,
    bookId,
    images: []
  };
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [books, setBooks] = useState<Book[]>([]);
  const [prompts, setPrompts] = useState<PromptItem[]>([]);
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [autoRefreshError, setAutoRefreshError] = useState("");
  const [modalToast, setModalToast] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<number[]>([]);

  const [createMode, setCreateMode] = useState<CreateMode>("paste");

  const [taskFiles, setTaskFiles] = useState<File[]>([]);
  const [batchName, setBatchName] = useState("批次");
  const [promptId, setPromptId] = useState<number | "">("");
  const [folderBindings, setFolderBindings] = useState<Record<string, number>>({});
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  const [pasteGroups, setPasteGroups] = useState<PastedGroup[]>([createEmptyPasteGroup(1)]);
  const [activeGroupId, setActiveGroupId] = useState<string>("");
  const pasteZoneRef = useRef<HTMLDivElement | null>(null);
  const pasteSeqRef = useRef(0);

  useEffect(() => {
    if (!activeGroupId && pasteGroups.length > 0) {
      setActiveGroupId(pasteGroups[0].id);
    }
  }, [activeGroupId, pasteGroups]);

  const activePasteGroup = useMemo(
    () => pasteGroups.find((g) => g.id === activeGroupId) || null,
    [pasteGroups, activeGroupId]
  );

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

  const hasUnsavedCreateData = useMemo(() => {
    if (taskFiles.length > 0) return true;
    return pasteGroups.some((g) => g.images.length > 0);
  }, [taskFiles, pasteGroups]);

  const submitReadyGroups = useMemo(
    () => pasteGroups.filter((g) => g.images.length > 0),
    [pasteGroups]
  );

  const filteredTasks = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!q) return tasks;
    return tasks.filter((task) => {
      const title = (task.display_title || "").toLowerCase();
      const taskName = (task.folder_name || "").toLowerCase();
      return title.includes(q) || taskName.includes(q);
    });
  }, [tasks, keyword]);

  function showModalToast(message: string) {
    setModalToast(message);
    window.setTimeout(() => setModalToast(""), 1800);
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

  async function downloadSingleTask(task: Task) {
    try {
      const resp = await apiFetchResponse(`/tasks/${task.id}/download`);
      const blob = await resp.blob();
      const name = getDownloadFilename(resp, `task_${task.id}.txt`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      await loadDataSilently();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function downloadBatchTasks() {
    if (selectedTaskIds.length === 0) {
      setError("请先勾选任务再批量下载。");
      return;
    }
    try {
      const resp = await apiFetchResponse("/tasks/download-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task_ids: selectedTaskIds }),
      });
      const blob = await resp.blob();
      const name = getDownloadFilename(resp, "xhsocr_export.zip");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      await loadDataSilently();
    } catch (e) {
      setError((e as Error).message);
    }
  }

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
      const promptData = await apiFetch<PromptItem[]>("/prompts?enabled=true");
      setPrompts(promptData);
      if (promptData.length > 0) {
        const recentPrompt = taskData.find((t) => t.task_type === "ocr" && t.prompt_id && promptData.some((p) => p.id === t.prompt_id))
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
        apiFetch<Task[]>("/tasks"),
        apiFetch<Book[]>("/books")
      ]);
      setTasks(taskData);
      setBooks(bookData);
      const promptData = await apiFetch<PromptItem[]>("/prompts?enabled=true");
      setPrompts(promptData);
      if (promptData.length > 0 && (promptId === "" || !promptData.some((p) => p.id === promptId))) {
        const recentPrompt = taskData.find((t) => t.task_type === "ocr" && t.prompt_id && promptData.some((p) => p.id === t.prompt_id))
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
    setSelectedTaskIds((prev) => prev.filter((id) => tasks.some((t) => t.id === id)));
  }, [tasks]);

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

  useEffect(() => {
    if (!isCreateOpen || createMode !== "paste") return;
    pasteZoneRef.current?.focus();
  }, [isCreateOpen, createMode, activeGroupId]);

  function resetCreateForm() {
    for (const g of pasteGroups) {
      for (const img of g.images) URL.revokeObjectURL(img.previewUrl);
    }
    setTaskFiles([]);
    setFolderBindings({});
    setBatchName("批次");
    if (prompts.length > 0) {
      const recentPrompt = tasks.find((t) => t.task_type === "ocr" && t.prompt_id && prompts.some((p) => p.id === t.prompt_id))
        ?.prompt_id;
      setPromptId(recentPrompt || prompts[0].id);
    } else {
      setPromptId("");
    }
    setCreateMode("paste");
    const first = createEmptyPasteGroup(1);
    setPasteGroups([first]);
    setActiveGroupId(first.id);
    pasteSeqRef.current = 0;
  }

  function openCreateModal() {
    resetCreateForm();
    setError("");
    setIsCreateOpen(true);
  }

  function closeCreateModal() {
    if (hasUnsavedCreateData) {
      const ok = window.confirm("当前有未提交的图片内容，确认放弃并关闭吗？");
      if (!ok) return;
    }
    resetCreateForm();
    setIsCreateOpen(false);
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

  async function onToggleFeatured(task: Task) {
    if (task.status !== "success") return;
    setLoading(true);
    setError("");
    try {
      await apiFetch(`/tasks/${task.id}/feature`, {
        method: task.is_featured ? "DELETE" : "POST",
      });
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
        const rel = (f as UploadFile).webkitRelativePath || f.name;
        map.set(rel, f);
      }
      for (const f of nextFiles) {
        const rel = (f as UploadFile).webkitRelativePath || f.name;
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

  function switchCreateMode(mode: CreateMode) {
    setCreateMode(mode);
    setError("");
  }

  function onCreateNextGroup(defaultBookId?: number) {
    const next = createEmptyPasteGroup(pasteGroups.length + 1, defaultBookId);
    setPasteGroups((prev) => [...prev, next]);
    setActiveGroupId(next.id);
  }

  function onCompleteCurrentGroup() {
    if (!activePasteGroup) return;
    if (!activePasteGroup.bookId) {
      showModalToast("需要绑定书稿才能创建下一组。");
      return;
    }
    if (activePasteGroup.images.length === 0) {
      showModalToast("请上传图片后再创建下一组。");
      return;
    }
    onCreateNextGroup(activePasteGroup.bookId);
  }

  function updateGroupName(groupId: string, name: string) {
    setPasteGroups((prev) => prev.map((g) => (g.id === groupId ? { ...g, name } : g)));
  }

  function updateGroupBook(groupId: string, bookId: number) {
    setPasteGroups((prev) => prev.map((g) => (g.id === groupId ? { ...g, bookId } : g)));
  }

  function removeGroup(groupId: string) {
    setPasteGroups((prev) => {
      const target = prev.find((g) => g.id === groupId);
      if (target) {
        for (const img of target.images) URL.revokeObjectURL(img.previewUrl);
      }
      const next = prev.filter((g) => g.id !== groupId);
      if (next.length === 0) {
        const first = createEmptyPasteGroup(1);
        setActiveGroupId(first.id);
        return [first];
      }
      if (groupId === activeGroupId) setActiveGroupId(next[0].id);
      return next;
    });
  }

  function removePastedImage(groupId: string, imageId: string) {
    setPasteGroups((prev) =>
      prev.map((g) => {
        if (g.id !== groupId) return g;
        const target = g.images.find((img) => img.id === imageId);
        if (target) URL.revokeObjectURL(target.previewUrl);
        return { ...g, images: g.images.filter((img) => img.id !== imageId) };
      })
    );
  }

  function onPasteImages(e: React.ClipboardEvent<HTMLDivElement>) {
    if (!activePasteGroup) return;
    const items = Array.from(e.clipboardData.items || []);
    const imageItems = items.filter((item) => item.kind === "file" && ALLOWED_MIME_TYPES.has(item.type));
    if (imageItems.length === 0) {
      setError("剪贴板中没有可用图片（仅支持 PNG/JPEG/WEBP）。");
      return;
    }

    e.preventDefault();
    setError("");

    setPasteGroups((prev) =>
      prev.map((g) => {
        if (g.id !== activePasteGroup.id) return g;
        const nextImages = [...g.images];
        for (const item of imageItems) {
          if (nextImages.length >= MAX_GROUP_IMAGES) {
            setError(`每组最多 ${MAX_GROUP_IMAGES} 张图片。`);
            break;
          }
          const file = item.getAsFile();
          if (!file) continue;
          if (file.size > MAX_IMAGE_BYTES) {
            setError(`存在超过 ${MAX_IMAGE_SIZE_MB}MB 的图片，已跳过。`);
            continue;
          }
          pasteSeqRef.current += 1;
          nextImages.push({
            id: createId(),
            file,
            pastedAt: Date.now() * 1000 + pasteSeqRef.current,
            previewUrl: URL.createObjectURL(file)
          });
        }
        return { ...g, images: nextImages };
      })
    );
  }

  async function submitFolderTasks(): Promise<boolean> {
    if (taskFiles.length === 0 || folderNames.length === 0) {
      setError("请先上传目录");
      return false;
    }
    if (!promptId) {
      setError("请选择提示词。");
      return false;
    }
    for (const folder of folderNames) {
      if (!folderBindings[folder]) {
        setError(`目录 ${folder} 未绑定书稿`);
        return false;
      }
    }

    const fd = new FormData();
    fd.append(
      "bindings",
      JSON.stringify(folderNames.map((folder) => ({ folder_name: folder, book_id: folderBindings[folder] })))
    );
    fd.append("batch_name", batchName || "batch");
    fd.append("prompt_id", String(promptId));
    fd.append("auto_enqueue", "true");
    for (const file of taskFiles) {
      const rel = (file as UploadFile).webkitRelativePath || file.name;
      fd.append("files", file, rel);
    }
    await apiFetch<TaskCreateResponse>("/tasks", { method: "POST", body: fd });
    return true;
  }

  async function submitPasteTasks(): Promise<boolean> {
    const groups = pasteGroups;
    if (groups.length === 0) {
      showModalToast("请上传图片后再提交");
      return false;
    }
    if (groups.length === 1) {
      const onlyGroup = groups[0];
      if (!onlyGroup.bookId) {
        showModalToast("请先绑定书稿后再提交");
        return false;
      }
      if (onlyGroup.images.length === 0) {
        showModalToast("请上传图片后再提交");
        return false;
      }
    } else {
      const lastGroup = groups[groups.length - 1];
      if (!lastGroup.bookId) {
        showModalToast("请先绑定书稿后再提交");
        return false;
      }
      if (lastGroup.images.length === 0) {
        showModalToast("请上传图片后再提交");
        return false;
      }
    }
    if (!promptId) {
      showModalToast("请选择提示词。");
      return false;
    }

    const fd = new FormData();
    const usedNames = new Set<string>();
    const bindings: Array<{ folder_name: string; book_id: number }> = [];

    for (const g of groups) {
      let base = sanitizeFolderName(g.name);
      let name = base;
      let i = 2;
      while (usedNames.has(name)) {
        name = `${base}_${i}`;
        i += 1;
      }
      usedNames.add(name);
      bindings.push({ folder_name: name, book_id: g.bookId as number });

      const ordered = [...g.images].sort((a, b) => a.pastedAt - b.pastedAt);
      ordered.forEach((img, idx) => {
        const ext = img.file.type === "image/png" ? "png" : img.file.type === "image/webp" ? "webp" : "jpg";
        const filename = `${name}/${String(idx + 1).padStart(3, "0")}_${createId()}.${ext}`;
        fd.append("files", img.file, filename);
      });
    }

    fd.append("bindings", JSON.stringify(bindings));
    fd.append("batch_name", batchName || "batch");
    fd.append("prompt_id", String(promptId));
    fd.append("auto_enqueue", "true");
    await apiFetch<TaskCreateResponse>("/tasks", { method: "POST", body: fd });
    return true;
  }

  async function onCreateTask(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      let ok = false;
      if (createMode === "folder") {
        ok = await submitFolderTasks();
      } else {
        ok = await submitPasteTasks();
      }
      if (!ok) return;
      resetCreateForm();
      setIsCreateOpen(false);
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
          <h1>仿写任务</h1>
          <p>创建任务、查看状态、进入任务详情、失败任务重试</p>
        </div>
        <div className="actions">
          <button onClick={() => void downloadBatchTasks()} disabled={loading || selectedTaskIds.length === 0}>
            批量下载（{selectedTaskIds.length}）
          </button>
          <button onClick={openCreateModal}>创建任务</button>
          <button onClick={() => void loadData()} disabled={loading}>刷新</button>
        </div>
      </header>

      {error ? <div className="errorBox">{error}</div> : null}
      {autoRefreshError ? <div className="errorBox">{autoRefreshError}</div> : null}

      <section className="card">
        <div className="toolbarRow">
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="按标题搜索任务"
          />
        </div>
        <div className="table">
          <div className="thead trow8">
            <span>选择</span>
            <span>ID</span>
            <span>任务名</span>
            <span>书稿名称</span>
            <span>提示词</span>
            <span>状态</span>
            <span>创建时间</span>
            <span>操作</span>
          </div>
          {filteredTasks.map((t) => (
            <div key={t.id} className="trow trow8">
              <span className="rowCheck">
                <input
                  type="checkbox"
                  checked={selectedTaskIds.includes(t.id)}
                  onChange={(e) =>
                    setSelectedTaskIds((prev) =>
                      e.target.checked ? [...prev, t.id] : prev.filter((id) => id !== t.id)
                    )
                  }
                />
              </span>
              <span>{t.id}</span>
              <span>{t.folder_name}</span>
              <span>{t.book_name || (t.book_id ? `ID:${t.book_id}` : "-")}</span>
              <span>{t.prompt_name || (t.prompt_id ? `ID:${t.prompt_id}` : "-")}</span>
              <span>{t.status}</span>
              <span>{formatBeijingDateTime(t.created_at)}</span>
              <span className="tableActionCell">
                <Link className="linkBtn" href={`/tasks/${t.id}`}>详情</Link>
                {t.status === "success" ? (
                  <button onClick={() => void onToggleFeatured(t)} disabled={loading}>
                    {t.is_featured ? "已精选" : "精选"}
                  </button>
                ) : null}
                <button onClick={() => void downloadSingleTask(t)} disabled={loading}>
                  {t.download_count > 0 ? "重新下载" : "下载"}
                </button>
                <button onClick={() => void onRetry(t.id, t.status)} disabled={loading}>重试</button>
                <button onClick={() => void onDelete(t.id)} disabled={loading || t.status === "processing"}>删除</button>
              </span>
            </div>
          ))}
          {filteredTasks.length === 0 ? <p className="empty">{tasks.length === 0 ? "暂无任务" : "没有匹配的任务"}</p> : null}
        </div>
      </section>

      {isCreateOpen ? (
        <div className="modalMask">
          <div className="modalCard" onClick={(e) => e.stopPropagation()}>
            {modalToast ? <div className="modalToast">{modalToast}</div> : null}
            <div className="rowHeader">
              <h2>创建任务</h2>
              <button onClick={closeCreateModal}>关闭</button>
            </div>

            <div className="createModeSwitch">
              <button
                type="button"
                className={createMode === "paste" ? "modeBtn active" : "modeBtn"}
                onClick={() => switchCreateMode("paste")}
              >
                粘贴上传
              </button>
              <button
                type="button"
                className={createMode === "folder" ? "modeBtn active" : "modeBtn"}
                onClick={() => switchCreateMode("folder")}
              >
                目录上传
              </button>
            </div>

            <form onSubmit={onCreateTask} className="stack">
              <input value={batchName} onChange={(e) => setBatchName(e.target.value)} placeholder="批次名（多组提交时生效）" />
              <select value={promptId} onChange={(e) => setPromptId(e.target.value ? Number(e.target.value) : "")}>
                <option value="">选择提示词（必选）</option>
                {prompts.map((p) => (
                  <option key={p.id} value={p.id}>
                    [{p.track}] {p.name}
                  </option>
                ))}
              </select>

              {createMode === "folder" ? (
                <>
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
                </>
              ) : (
                <div className="stack">
                  <div className="pasteGroupList">
                    {pasteGroups.map((group) => (
                      <button
                        key={group.id}
                        type="button"
                        className={group.id === activeGroupId ? "groupChip active" : "groupChip"}
                        onClick={() => setActiveGroupId(group.id)}
                      >
                        {group.name || "未命名分组"}（{group.images.length}）
                      </button>
                    ))}
                  </div>
                  {activePasteGroup ? (
                    <>
                      <div className="bindRow">
                        <span>分组名称</span>
                        <input
                          value={activePasteGroup.name}
                          onChange={(e) => updateGroupName(activePasteGroup.id, e.target.value)}
                          placeholder="可手动修改分组名"
                        />
                      </div>
                      <div className="bindRow">
                        <span>绑定书稿</span>
                        <select
                          value={activePasteGroup.bookId || ""}
                          onChange={(e) => updateGroupBook(activePasteGroup.id, Number(e.target.value))}
                        >
                          <option value="">选择书稿</option>
                          {books.map((book) => (
                            <option key={book.id} value={book.id}>
                              {book.id} - {book.title}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div
                        ref={pasteZoneRef}
                        className="pasteZone"
                        tabIndex={0}
                        onPaste={onPasteImages}
                      >
                        在这里按 Cmd/Ctrl + V 粘贴图片（支持 PNG/JPEG/WEBP，单图≤20MB，单组最多30张）
                      </div>
                      <div className="actions">
                        <button type="button" onClick={onCompleteCurrentGroup} disabled={loading}>完成本组并新建下一组</button>
                        <button type="button" onClick={() => removeGroup(activePasteGroup.id)} disabled={loading}>删除本组</button>
                      </div>
                      {activePasteGroup.images.length > 0 ? (
                        <div className="pasteImageList">
                          {activePasteGroup.images
                            .slice()
                            .sort((a, b) => b.pastedAt - a.pastedAt)
                            .map((img, idx, arr) => (
                              <div key={img.id} className="pasteImageRow">
                                <span>{String(arr.length - idx).padStart(2, "0")}.</span>
                                <img src={img.previewUrl} alt={`paste-${arr.length - idx}`} />
                                <span>{Math.round(img.file.size / 1024)} KB</span>
                                <button type="button" onClick={() => removePastedImage(activePasteGroup.id, img.id)}>删除</button>
                              </div>
                            ))}
                        </div>
                      ) : (
                        <p className="empty">当前组暂无图片，请先粘贴。</p>
                      )}
                      <p className="empty">可提交分组数：{submitReadyGroups.length}</p>
                    </>
                  ) : null}
                </div>
              )}

              <button type="submit" disabled={loading}>提交任务</button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
