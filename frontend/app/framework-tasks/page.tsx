"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { PaginationControls } from "../../components/pagination-controls";
import { apiFetch, apiFetchResponse } from "../../lib/api";
import { formatBeijingDateTime } from "../../lib/time";
import { Book, PaginatedResponse, PromptItem, Task, TaskCreateResponse } from "../../lib/types";

type CreateMode = "folder" | "paste" | "custom";
type UploadFile = File & { webkitRelativePath?: string };

type PastedImage = {
  id: string;
  file: File;
  pastedAt: number;
  previewUrl: string;
};

type GroupDefaults = {
  attribute?: string;
  bookId?: number;
  track?: string;
  promptId?: number;
};

type FolderGroup = {
  name: string;
  attribute: string;
  bookId?: number;
  track: string;
  promptId?: number;
};

type PastedGroup = {
  id: string;
  name: string;
  attribute: string;
  bookId?: number;
  track: string;
  promptId?: number;
  images: PastedImage[];
};

type CustomGroup = {
  id: string;
  name: string;
  attribute: string;
  title: string;
  pointsText: string;
  bookId?: number;
  promptId?: number;
};

const ALLOWED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_GROUP_IMAGES = 30;
const MAX_IMAGE_SIZE_MB = 20;
const MAX_IMAGE_BYTES = MAX_IMAGE_SIZE_MB * 1024 * 1024;
const PAGE_SIZE = 50;

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

function createEmptyFolderGroup(name: string, defaults?: GroupDefaults): FolderGroup {
  return {
    name,
    attribute: defaults?.attribute || "",
    bookId: defaults?.bookId,
    track: defaults?.track || "",
    promptId: defaults?.promptId,
  };
}

function createEmptyPasteGroup(index: number, defaults?: GroupDefaults): PastedGroup {
  return {
    id: createId(),
    name: `任务-${index}`,
    attribute: defaults?.attribute || "",
    bookId: defaults?.bookId,
    track: defaults?.track || "",
    promptId: defaults?.promptId,
    images: []
  };
}

function createEmptyCustomGroup(index: number, defaults?: GroupDefaults): CustomGroup {
  return {
    id: createId(),
    name: `任务-${index}`,
    attribute: defaults?.attribute || "",
    title: "",
    pointsText: "",
    bookId: defaults?.bookId,
    promptId: defaults?.promptId,
  };
}

function displayAttribute(attribute: string) {
  return attribute === "__NULL__" ? "无属性" : attribute;
}

function normalizeAttribute(attribute?: string | null) {
  return attribute ?? "__NULL__";
}

export default function FrameworkTasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [books, setBooks] = useState<Book[]>([]);
  const [prompts, setPrompts] = useState<PromptItem[]>([]);
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [autoRefreshError, setAutoRefreshError] = useState("");
  const [modalToast, setModalToast] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<number[]>([]);

  const [createMode, setCreateMode] = useState<CreateMode>("paste");
  const [taskFiles, setTaskFiles] = useState<File[]>([]);
  const [batchName, setBatchName] = useState("批次");
  const [attributes, setAttributes] = useState<string[]>([]);
  const [folderGroups, setFolderGroups] = useState<FolderGroup[]>([]);
  const [activeFolderGroupName, setActiveFolderGroupName] = useState("");
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  const [pasteGroups, setPasteGroups] = useState<PastedGroup[]>([createEmptyPasteGroup(1)]);
  const [activeGroupId, setActiveGroupId] = useState<string>("");
  const [customGroups, setCustomGroups] = useState<CustomGroup[]>([]);
  const [activeCustomGroupId, setActiveCustomGroupId] = useState<string>("");
  const pasteZoneRef = useRef<HTMLDivElement | null>(null);
  const pasteSeqRef = useRef(0);

  useEffect(() => {
    if (!activeFolderGroupName && folderGroups.length > 0) {
      setActiveFolderGroupName(folderGroups[0].name);
    }
  }, [activeFolderGroupName, folderGroups]);

  useEffect(() => {
    if (!activeGroupId && pasteGroups.length > 0) {
      setActiveGroupId(pasteGroups[0].id);
    }
  }, [activeGroupId, pasteGroups]);

  useEffect(() => {
    if (!activeCustomGroupId && customGroups.length > 0) {
      setActiveCustomGroupId(customGroups[0].id);
    }
  }, [activeCustomGroupId, customGroups]);

  const activeFolderGroup = useMemo(
    () => folderGroups.find((g) => g.name === activeFolderGroupName) || null,
    [folderGroups, activeFolderGroupName]
  );

  const activePasteGroup = useMemo(
    () => pasteGroups.find((g) => g.id === activeGroupId) || null,
    [pasteGroups, activeGroupId]
  );

  const activeCustomGroup = useMemo(
    () => customGroups.find((g) => g.id === activeCustomGroupId) || null,
    [customGroups, activeCustomGroupId]
  );

  const folderNames = useMemo(() => folderGroups.map((group) => group.name), [folderGroups]);

  const folderFileCount = useMemo(() => {
    const countMap: Record<string, number> = {};
    for (const f of taskFiles) {
      const folder = extractFolderName(f);
      countMap[folder] = (countMap[folder] || 0) + 1;
    }
    return countMap;
  }, [taskFiles]);

  const promptMap = useMemo(() => new Map(prompts.map((prompt) => [prompt.id, prompt])), [prompts]);

  const hasUnsavedCreateData = useMemo(() => {
    if (taskFiles.length > 0) return true;
    if (pasteGroups.some((g) => g.images.length > 0)) return true;
    return customGroups.some((g) => g.title.trim() || g.pointsText.trim());
  }, [taskFiles, pasteGroups, customGroups]);

  const submitReadyFolderGroups = useMemo(
    () => folderGroups.filter((g) => (folderFileCount[g.name] || 0) > 0),
    [folderGroups, folderFileCount]
  );

  const submitReadyGroups = useMemo(
    () => pasteGroups.filter((g) => g.images.length > 0),
    [pasteGroups]
  );

  const submitReadyCustomGroups = useMemo(
    () => customGroups.filter((g) => g.title.trim() || g.pointsText.trim()),
    [customGroups]
  );

  const hasPendingTasks = useMemo(
    () => tasks.some((t) => t.status === "waiting" || t.status === "processing"),
    [tasks]
  );

  useEffect(() => {
    const nextNames = Array.from(new Set(taskFiles.map((file) => extractFolderName(file)))).sort();
    setFolderGroups((prev) => {
      const prevMap = new Map(prev.map((group) => [group.name, group]));
      return nextNames.map((name) => prevMap.get(name) || createEmptyFolderGroup(name));
    });
    if (nextNames.length === 0) {
      setActiveFolderGroupName("");
      return;
    }
    setActiveFolderGroupName((current) => (current && nextNames.includes(current) ? current : nextNames[0]));
  }, [taskFiles]);

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

  function booksForAttribute(attribute: string) {
    if (!attribute) return [];
    return books.filter((book) => normalizeAttribute(book.attribute) === attribute);
  }

  function tracksForAttribute(attribute: string) {
    if (!attribute) return [];
    return Array.from(
      new Set(
        prompts
          .filter((prompt) => normalizeAttribute(prompt.attribute) === attribute)
          .map((prompt) => prompt.track)
      )
    ).sort((a, b) => a.localeCompare(b, "zh-CN"));
  }

  function promptsForTrack(attribute: string, track: string) {
    if (!attribute || !track) return [];
    return prompts.filter(
      (prompt) => normalizeAttribute(prompt.attribute) === attribute && prompt.track === track
    );
  }

  function promptsForAttribute(attribute: string) {
    if (!attribute) return [];
    return prompts.filter((prompt) => normalizeAttribute(prompt.attribute) === attribute);
  }

  function isFolderGroupReady(group: FolderGroup) {
    return Boolean(
      (folderFileCount[group.name] || 0) > 0 &&
        (!attributes.length || group.attribute) &&
        group.bookId &&
        group.track &&
        group.promptId
    );
  }

  function isPasteGroupReady(group: PastedGroup) {
    return Boolean(
      group.images.length > 0 &&
        (!attributes.length || group.attribute) &&
        group.bookId &&
        group.track &&
        group.promptId
    );
  }

  function isCustomGroupReady(group: CustomGroup) {
    return Boolean(
      (!attributes.length || group.attribute) &&
      group.bookId &&
      group.promptId &&
      group.title.trim() &&
      group.pointsText.split("\n").some((line) => line.trim())
    );
  }

  async function downloadSingleTask(task: Task) {
    try {
      const resp = await apiFetchResponse(`/tasks/${task.id}/download`);
      const blob = await resp.blob();
      const name = getDownloadFilename(resp, `framework_task_${task.id}.txt`);
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

  function buildTasksPath(pageValue: number, titleValue: string) {
    const params = new URLSearchParams({
      task_type: "framework",
      page: String(pageValue),
      page_size: String(PAGE_SIZE),
    });
    const title = titleValue.trim();
    if (title) params.set("title", title);
    return `/tasks?${params.toString()}`;
  }

  async function loadPromptList() {
    const params = new URLSearchParams({ enabled: "true" });
    const promptData = await apiFetch<PromptItem[]>(`/prompts?${params.toString()}`);
    setPrompts(promptData);
  }

  async function loadBookList() {
    const bookData = await apiFetch<Book[]>("/books");
    setBooks(bookData);
  }

  async function loadTaskPage(options?: {
    page?: number;
    title?: string;
    includeAuxiliary?: boolean;
    silent?: boolean;
  }) {
    const nextPage = options?.page ?? page;
    const nextTitle = options?.title ?? keyword;
    const includeAuxiliary = options?.includeAuxiliary ?? false;
    const silent = options?.silent ?? false;

    if (!silent) {
      setLoading(true);
      setError("");
    }

    try {
      const requests: [
        Promise<PaginatedResponse<Task>>,
        Promise<string[]> | null
      ] = [
        apiFetch<PaginatedResponse<Task>>(buildTasksPath(nextPage, nextTitle)),
        includeAuxiliary ? apiFetch<string[]>("/prompts/attributes") : null,
      ];
      const [taskPage, attributeData] = await Promise.all(requests);
      setTasks(taskPage.items);
      setPage(taskPage.page);
      setTotal(taskPage.total);
      setTotalPages(taskPage.total_pages);
      if (attributeData) setAttributes(attributeData);
      if (includeAuxiliary) {
        await loadPromptList();
        await loadBookList();
      }
      if (silent) setAutoRefreshError("");
    } catch (e) {
      if (silent) {
        setAutoRefreshError(`自动刷新失败：${(e as Error).message}`);
      } else {
        setError((e as Error).message);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }

  async function loadData(includeAuxiliary = true) {
    await loadTaskPage({ includeAuxiliary });
  }

  async function loadDataSilently() {
    await loadTaskPage({ silent: true });
  }

  useEffect(() => {
    void loadTaskPage({ includeAuxiliary: books.length === 0 || attributes.length === 0 });
  }, [page, keyword]);

  useEffect(() => {
    if (attributes.length === 0) return;
    void loadPromptList();
    void loadBookList();
  }, [attributes.length]);

  useEffect(() => {
    setFolderGroups((prev) =>
      prev.map((group) => {
        const validBookIds = new Set(booksForAttribute(group.attribute).map((book) => book.id));
        const validTracks = new Set(tracksForAttribute(group.attribute));
        const nextBookId = group.bookId && validBookIds.has(group.bookId) ? group.bookId : undefined;
        const nextTrack = group.track && validTracks.has(group.track) ? group.track : "";
        const prompt = group.promptId ? promptMap.get(group.promptId) : undefined;
        const nextPromptId =
          prompt && normalizeAttribute(prompt.attribute) === group.attribute && prompt.track === nextTrack
            ? group.promptId
            : undefined;
        return nextBookId === group.bookId && nextTrack === group.track && nextPromptId === group.promptId
          ? group
          : { ...group, bookId: nextBookId, track: nextTrack, promptId: nextPromptId };
      })
    );
    setPasteGroups((prev) =>
      prev.map((group) => {
        const validBookIds = new Set(booksForAttribute(group.attribute).map((book) => book.id));
        const validTracks = new Set(tracksForAttribute(group.attribute));
        const nextBookId = group.bookId && validBookIds.has(group.bookId) ? group.bookId : undefined;
        const nextTrack = group.track && validTracks.has(group.track) ? group.track : "";
        const prompt = group.promptId ? promptMap.get(group.promptId) : undefined;
        const nextPromptId =
          prompt && normalizeAttribute(prompt.attribute) === group.attribute && prompt.track === nextTrack
            ? group.promptId
            : undefined;
        return nextBookId === group.bookId && nextTrack === group.track && nextPromptId === group.promptId
          ? group
          : { ...group, bookId: nextBookId, track: nextTrack, promptId: nextPromptId };
      })
    );
    setCustomGroups((prev) =>
      prev.map((group) => {
        const validBookIds = new Set(booksForAttribute(group.attribute).map((book) => book.id));
        const nextBookId = group.bookId && validBookIds.has(group.bookId) ? group.bookId : undefined;
        const prompt = group.promptId ? promptMap.get(group.promptId) : undefined;
        const nextPromptId =
          prompt && normalizeAttribute(prompt.attribute) === group.attribute ? group.promptId : undefined;
        return nextBookId === group.bookId && nextPromptId === group.promptId
          ? group
          : { ...group, bookId: nextBookId, promptId: nextPromptId };
      })
    );
  }, [books, promptMap, prompts]);

  useEffect(() => {
    setSelectedTaskIds((prev) => prev.filter((id) => tasks.some((t) => t.id === id)));
  }, [tasks]);

  useEffect(() => {
    const intervalMs = hasPendingTasks ? 3000 : 15000;
    const tick = () => {
      if (document.hidden) return;
      void loadDataSilently();
    };
    const timer = setInterval(tick, intervalMs);
    return () => clearInterval(timer);
  }, [hasPendingTasks, page, keyword]);

  useEffect(() => {
    if (!isCreateOpen || createMode !== "paste") return;
    pasteZoneRef.current?.focus();
  }, [isCreateOpen, createMode, activeGroupId]);

  function resetCreateForm() {
    for (const g of pasteGroups) {
      for (const img of g.images) URL.revokeObjectURL(img.previewUrl);
    }
    setTaskFiles([]);
    setFolderGroups([]);
    setActiveFolderGroupName("");
    setBatchName("批次");
    setCreateMode("paste");
    const first = createEmptyPasteGroup(1);
    setPasteGroups([first]);
    setActiveGroupId(first.id);
    const firstCustom = createEmptyCustomGroup(1);
    setCustomGroups([firstCustom]);
    setActiveCustomGroupId(firstCustom.id);
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
    setFolderGroups((prev) => prev.filter((group) => group.name !== folder));
    setActiveFolderGroupName((current) => (current === folder ? "" : current));
  }

  function switchCreateMode(mode: CreateMode) {
    setCreateMode(mode);
    setError("");
  }

  function onCreateNextPasteGroup(defaults?: GroupDefaults) {
    const next = createEmptyPasteGroup(pasteGroups.length + 1, defaults);
    setPasteGroups((prev) => [...prev, next]);
    setActiveGroupId(next.id);
  }

  function onCreateNextCustomGroup(defaults?: GroupDefaults) {
    const next = createEmptyCustomGroup(customGroups.length + 1, defaults);
    setCustomGroups((prev) => [...prev, next]);
    setActiveCustomGroupId(next.id);
  }

  function onCompleteCurrentFolderGroup() {
    if (!activeFolderGroup) return;
    if (attributes.length > 0 && !activeFolderGroup.attribute) {
      showModalToast("需要选择属性才能进入下一组。");
      return;
    }
    if (!activeFolderGroup.bookId) {
      showModalToast("需要绑定书稿才能进入下一组。");
      return;
    }
    if (!activeFolderGroup.track) {
      showModalToast("需要选择赛道才能进入下一组。");
      return;
    }
    if (!activeFolderGroup.promptId) {
      showModalToast("需要选择提示词才能进入下一组。");
      return;
    }
    const currentIndex = folderGroups.findIndex((group) => group.name === activeFolderGroup.name);
    const nextGroup = folderGroups[currentIndex + 1];
    if (!nextGroup) {
      showModalToast("已经是最后一组。");
      return;
    }
    setFolderGroups((prev) =>
      prev.map((group, index) =>
        index === currentIndex + 1
          ? {
              ...group,
              attribute: group.attribute || activeFolderGroup.attribute,
              bookId: group.bookId ?? activeFolderGroup.bookId,
              track: group.track || activeFolderGroup.track,
              promptId: group.promptId ?? activeFolderGroup.promptId,
            }
          : group
      )
    );
    setActiveFolderGroupName(nextGroup.name);
  }

  function onCompleteCurrentGroup() {
    if (!activePasteGroup) return;
    if (attributes.length > 0 && !activePasteGroup.attribute) {
      showModalToast("需要选择属性才能创建下一组。");
      return;
    }
    if (!activePasteGroup.bookId) {
      showModalToast("需要绑定书稿才能创建下一组。");
      return;
    }
    if (!activePasteGroup.track) {
      showModalToast("需要选择赛道才能创建下一组。");
      return;
    }
    if (!activePasteGroup.promptId) {
      showModalToast("需要选择提示词才能创建下一组。");
      return;
    }
    if (activePasteGroup.images.length === 0) {
      showModalToast("请上传图片后再创建下一组。");
      return;
    }
    onCreateNextPasteGroup({
      attribute: activePasteGroup.attribute,
      bookId: activePasteGroup.bookId,
      track: activePasteGroup.track,
      promptId: activePasteGroup.promptId,
    });
  }

  function onCompleteCurrentCustomGroup() {
    if (!activeCustomGroup) return;
    if (attributes.length > 0 && !activeCustomGroup.attribute) {
      showModalToast("需要选择属性才能创建下一组。");
      return;
    }
    if (!activeCustomGroup.bookId) {
      showModalToast("需要绑定书稿才能创建下一组。");
      return;
    }
    if (!activeCustomGroup.promptId) {
      showModalToast("需要选择提示词才能创建下一组。");
      return;
    }
    if (!activeCustomGroup.title.trim()) {
      showModalToast("请填写标题后再创建下一组。");
      return;
    }
    if (!activeCustomGroup.pointsText.split("\n").some((line) => line.trim())) {
      showModalToast("请填写分点观点后再创建下一组。");
      return;
    }
    onCreateNextCustomGroup({
      attribute: activeCustomGroup.attribute,
      bookId: activeCustomGroup.bookId,
      promptId: activeCustomGroup.promptId,
    });
  }

  function updateFolderGroup(groupName: string, patch: Partial<FolderGroup>) {
    setFolderGroups((prev) =>
      prev.map((group) => {
        if (group.name !== groupName) return group;
        const next = { ...group, ...patch };
        if (patch.attribute !== undefined) {
          next.bookId = undefined;
          next.track = "";
          next.promptId = undefined;
          return next;
        }
        if (patch.track !== undefined) {
          const selectedPrompt = next.promptId ? promptMap.get(next.promptId) : undefined;
          if (
            !selectedPrompt ||
            normalizeAttribute(selectedPrompt.attribute) !== next.attribute ||
            selectedPrompt.track !== next.track
          ) {
            next.promptId = undefined;
          }
        }
        return next;
      })
    );
  }

  function updateGroupName(groupId: string, name: string) {
    setPasteGroups((prev) => prev.map((g) => (g.id === groupId ? { ...g, name } : g)));
  }

  function updateGroupAttribute(groupId: string, attribute: string) {
    setPasteGroups((prev) =>
      prev.map((group) =>
        group.id === groupId ? { ...group, attribute, bookId: undefined, track: "", promptId: undefined } : group
      )
    );
  }

  function updateGroupBook(groupId: string, bookId: number) {
    setPasteGroups((prev) => prev.map((g) => (g.id === groupId ? { ...g, bookId: bookId || undefined } : g)));
  }

  function updateGroupTrack(groupId: string, track: string) {
    setPasteGroups((prev) =>
      prev.map((group) => {
        if (group.id !== groupId) return group;
        const selectedPrompt = group.promptId ? promptMap.get(group.promptId) : undefined;
        return {
          ...group,
          track,
          promptId:
            selectedPrompt &&
            normalizeAttribute(selectedPrompt.attribute) === group.attribute &&
            selectedPrompt.track === track
              ? group.promptId
              : undefined,
        };
      })
    );
  }

  function updateGroupPrompt(groupId: string, value: number) {
    setPasteGroups((prev) =>
      prev.map((group) => (group.id === groupId ? { ...group, promptId: value || undefined } : group))
    );
  }

  function updateCustomGroup(groupId: string, patch: Partial<CustomGroup>) {
    setCustomGroups((prev) =>
      prev.map((group) => {
        if (group.id !== groupId) return group;
        const next = { ...group, ...patch };
        if (patch.attribute !== undefined) {
          next.bookId = undefined;
          next.promptId = undefined;
        }
        return next;
      })
    );
  }

  function copyCurrentPasteGroup() {
    if (!activePasteGroup) return;
    if (activePasteGroup.images.length === 0) {
      showModalToast("当前组没有图片可复制。");
      return;
    }
    const copiedImages = activePasteGroup.images
      .slice()
      .sort((a, b) => a.pastedAt - b.pastedAt)
      .map((image, index) => ({
        id: createId(),
        file: image.file,
        pastedAt: Date.now() * 1000 + index + 1,
        previewUrl: URL.createObjectURL(image.file),
      }));
    const next = createEmptyPasteGroup(pasteGroups.length + 1, {
      attribute: activePasteGroup.attribute,
      bookId: activePasteGroup.bookId,
      track: activePasteGroup.track,
      promptId: activePasteGroup.promptId,
    });
    next.images = copiedImages;
    setPasteGroups((prev) => [...prev, next]);
    setActiveGroupId(next.id);
    showModalToast("已复制到新组。");
  }

  function copyCurrentCustomGroup() {
    if (!activeCustomGroup) return;
    if (!activeCustomGroup.title.trim() && !activeCustomGroup.pointsText.trim()) {
      showModalToast("当前组没有可复制的内容。");
      return;
    }
    const next = createEmptyCustomGroup(customGroups.length + 1, {
      attribute: activeCustomGroup.attribute,
      bookId: activeCustomGroup.bookId,
      promptId: activeCustomGroup.promptId,
    });
    next.title = activeCustomGroup.title;
    next.pointsText = activeCustomGroup.pointsText;
    setCustomGroups((prev) => [...prev, next]);
    setActiveCustomGroupId(next.id);
    showModalToast("已复制到新组。");
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

  function removeCustomGroup(groupId: string) {
    setCustomGroups((prev) => {
      const next = prev.filter((g) => g.id !== groupId);
      if (next.length === 0) {
        const first = createEmptyCustomGroup(1);
        setActiveCustomGroupId(first.id);
        return [first];
      }
      if (groupId === activeCustomGroupId) setActiveCustomGroupId(next[0].id);
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
    for (const group of folderGroups) {
      if ((folderFileCount[group.name] || 0) === 0) continue;
      if (attributes.length > 0 && !group.attribute) {
        setError(`目录 ${group.name} 未选择属性`);
        return false;
      }
      if (!group.bookId) {
        setError(`目录 ${group.name} 未绑定书稿`);
        return false;
      }
      if (!group.track) {
        setError(`目录 ${group.name} 未选择赛道`);
        return false;
      }
      if (!group.promptId) {
        setError(`目录 ${group.name} 未选择提示词`);
        return false;
      }
    }

    const fd = new FormData();
    fd.append(
      "bindings",
      JSON.stringify(
        folderGroups
          .filter((group) => (folderFileCount[group.name] || 0) > 0)
          .map((group) => ({
            folder_name: group.name,
            book_id: group.bookId,
            prompt_id: group.promptId,
          }))
      )
    );
    fd.append("batch_name", batchName || "batch");
    fd.append("auto_enqueue", "true");
    for (const file of taskFiles) {
      const rel = (file as UploadFile).webkitRelativePath || file.name;
      fd.append("files", file, rel);
    }
    await apiFetch<TaskCreateResponse>("/tasks/framework", { method: "POST", body: fd });
    return true;
  }

  async function submitPasteTasks(): Promise<boolean> {
    const groups = pasteGroups.filter((group) => group.images.length > 0);
    if (groups.length === 0) {
      showModalToast("请上传图片后再提交");
      return false;
    }
    for (const group of groups) {
      if (attributes.length > 0 && !group.attribute) {
        showModalToast(`请先为 ${group.name} 选择属性后再提交`);
        return false;
      }
      if (!group.bookId) {
        showModalToast(`请先为 ${group.name} 绑定书稿后再提交`);
        return false;
      }
      if (!group.track) {
        showModalToast(`请先为 ${group.name} 选择赛道后再提交`);
        return false;
      }
      if (!group.promptId) {
        showModalToast(`请先为 ${group.name} 选择提示词后再提交`);
        return false;
      }
    }

    const fd = new FormData();
    const usedNames = new Set<string>();
    const bindings: Array<{ folder_name: string; book_id: number; prompt_id: number }> = [];

    for (const g of groups) {
      let base = sanitizeFolderName(g.name);
      let name = base;
      let i = 2;
      while (usedNames.has(name)) {
        name = `${base}_${i}`;
        i += 1;
      }
      usedNames.add(name);
      bindings.push({ folder_name: name, book_id: g.bookId as number, prompt_id: g.promptId as number });

      const ordered = [...g.images].sort((a, b) => a.pastedAt - b.pastedAt);
      ordered.forEach((img, idx) => {
        const ext = img.file.type === "image/png" ? "png" : img.file.type === "image/webp" ? "webp" : "jpg";
        const filename = `${name}/${String(idx + 1).padStart(3, "0")}_${createId()}.${ext}`;
        fd.append("files", img.file, filename);
      });
    }

    fd.append("bindings", JSON.stringify(bindings));
    fd.append("batch_name", batchName || "batch");
    fd.append("auto_enqueue", "true");
    await apiFetch<TaskCreateResponse>("/tasks/framework", { method: "POST", body: fd });
    return true;
  }

  async function submitCustomTasks(): Promise<boolean> {
    const groups = customGroups;
    if (groups.length === 0) {
      showModalToast("请先填写任务后再提交");
      return false;
    }
    const validateGroup = (group: CustomGroup) => {
      if (attributes.length > 0 && !group.attribute) {
        showModalToast("请先选择属性后再提交");
        return false;
      }
      if (!group.bookId) {
        showModalToast("请先绑定书稿后再提交");
        return false;
      }
      if (!group.promptId) {
        showModalToast("请选择提示词后再提交");
        return false;
      }
      if (!group.title.trim()) {
        showModalToast("请填写标题后再提交");
        return false;
      }
      if (!group.pointsText.split("\n").some((line) => line.trim())) {
        showModalToast("请填写分点观点后再提交");
        return false;
      }
      return true;
    };

    if (groups.length === 1) {
      if (!validateGroup(groups[0])) return false;
    } else {
      const lastGroup = groups[groups.length - 1];
      if (!validateGroup(lastGroup)) return false;
    }

    await apiFetch<TaskCreateResponse>("/tasks/framework-custom", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        batch_name: batchName || "批次",
        auto_enqueue: true,
        tasks: groups.map((group) => ({
          task_name: group.name,
          title: group.title,
          points_text: group.pointsText,
          book_id: group.bookId,
          prompt_id: group.promptId,
        })),
      }),
    });
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
      } else if (createMode === "paste") {
        ok = await submitPasteTasks();
      } else {
        ok = await submitCustomTasks();
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
          <h1>原创创作（框架）</h1>
          <p>图片OCR → 自动提取标题与分点 → 单提示词生成最终正文</p>
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
            onChange={(e) => {
              setKeyword(e.target.value);
              setPage(1);
            }}
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
          {tasks.map((t) => (
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
                <Link className="linkBtn" href={`/framework-tasks/${t.id}`}>详情</Link>
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
          {tasks.length === 0 ? <p className="empty">{total === 0 ? "暂无任务" : "没有匹配的任务"}</p> : null}
        </div>
        <PaginationControls
          page={page}
          totalPages={totalPages}
          total={total}
          pageSize={PAGE_SIZE}
          disabled={loading}
          onChange={setPage}
        />
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
              <button
                type="button"
                className={createMode === "custom" ? "modeBtn active" : "modeBtn"}
                onClick={() => switchCreateMode("custom")}
              >
                自定义上传
              </button>
            </div>

            <form onSubmit={onCreateTask} className="stack">
              <input value={batchName} onChange={(e) => setBatchName(e.target.value)} placeholder="批次名（多组提交时生效）" />

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
                  {folderGroups.length > 0 ? (
                    <div className="stack">
                      <div className="pasteGroupList">
                        {folderGroups.map((group) => (
                          <button
                            key={group.name}
                            type="button"
                            className={group.name === activeFolderGroupName ? "groupChip active" : "groupChip"}
                            onClick={() => setActiveFolderGroupName(group.name)}
                          >
                            {group.name}（{folderFileCount[group.name] || 0}）
                          </button>
                        ))}
                      </div>
                      {activeFolderGroup ? (
                        <>
                          <div className="bindRow">
                            <span>当前目录</span>
                            <span>{activeFolderGroup.name}（{folderFileCount[activeFolderGroup.name] || 0} 张）</span>
                            <button type="button" onClick={() => removeFolder(activeFolderGroup.name)} disabled={loading}>移除目录</button>
                          </div>
                          {attributes.length > 0 ? (
                            <div className="bindRow">
                              <span>属性</span>
                              <select
                                value={activeFolderGroup.attribute}
                                onChange={(e) => updateFolderGroup(activeFolderGroup.name, { attribute: e.target.value })}
                              >
                                <option value="">选择属性（必选）</option>
                                {attributes.map((attribute) => (
                                  <option key={attribute} value={attribute}>
                                    {displayAttribute(attribute)}
                                  </option>
                                ))}
                              </select>
                            </div>
                          ) : null}
                          <div className="bindRow">
                            <span>绑定书稿</span>
                            <select
                              value={activeFolderGroup.bookId || ""}
                              onChange={(e) => updateFolderGroup(activeFolderGroup.name, { bookId: Number(e.target.value) || undefined })}
                              disabled={attributes.length > 0 && !activeFolderGroup.attribute}
                            >
                              <option value="">
                                {attributes.length > 0 && !activeFolderGroup.attribute ? "先选择属性后再选择书稿" : "选择书稿"}
                              </option>
                              {booksForAttribute(activeFolderGroup.attribute).map((book) => (
                                <option key={book.id} value={book.id}>
                                  {book.id} - {book.title}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="bindRow">
                            <span>赛道</span>
                            <select
                              value={activeFolderGroup.track}
                              onChange={(e) => updateFolderGroup(activeFolderGroup.name, { track: e.target.value })}
                              disabled={attributes.length > 0 && !activeFolderGroup.attribute}
                            >
                              <option value="">
                                {attributes.length > 0 && !activeFolderGroup.attribute ? "先选择属性后再选择赛道" : "选择赛道"}
                              </option>
                              {tracksForAttribute(activeFolderGroup.attribute).map((track) => (
                                <option key={track} value={track}>
                                  {track}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="bindRow">
                            <span>提示词</span>
                            <select
                              value={activeFolderGroup.promptId || ""}
                              onChange={(e) => updateFolderGroup(activeFolderGroup.name, { promptId: Number(e.target.value) || undefined })}
                              disabled={attributes.length > 0 && !activeFolderGroup.attribute}
                            >
                              <option value="">
                                {!activeFolderGroup.attribute
                                  ? "先选择属性后再选择提示词"
                                  : activeFolderGroup.track
                                    ? "选择提示词"
                                    : "先选择赛道后再选择提示词"}
                              </option>
                              {promptsForTrack(activeFolderGroup.attribute, activeFolderGroup.track).map((prompt) => (
                                <option key={prompt.id} value={prompt.id}>
                                  [{prompt.track}] {prompt.name}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="actions">
                            <button type="button" onClick={onCompleteCurrentFolderGroup} disabled={loading}>完成本组并进入下一组</button>
                          </div>
                          <p className="empty">可提交目录组数：{submitReadyFolderGroups.length}</p>
                        </>
                      ) : null}
                    </div>
                  ) : (
                    <p className="empty">暂未选择目录</p>
                  )}
                </>
              ) : createMode === "paste" ? (
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
                      {attributes.length > 0 ? (
                        <div className="bindRow">
                          <span>属性</span>
                          <select
                            value={activePasteGroup.attribute}
                            onChange={(e) => updateGroupAttribute(activePasteGroup.id, e.target.value)}
                          >
                            <option value="">选择属性（必选）</option>
                            {attributes.map((attribute) => (
                              <option key={attribute} value={attribute}>
                                {displayAttribute(attribute)}
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : null}
                      <div className="bindRow">
                        <span>绑定书稿</span>
                        <select
                          value={activePasteGroup.bookId || ""}
                          onChange={(e) => updateGroupBook(activePasteGroup.id, Number(e.target.value))}
                          disabled={attributes.length > 0 && !activePasteGroup.attribute}
                        >
                          <option value="">
                            {attributes.length > 0 && !activePasteGroup.attribute ? "先选择属性后再选择书稿" : "选择书稿"}
                          </option>
                          {booksForAttribute(activePasteGroup.attribute).map((book) => (
                            <option key={book.id} value={book.id}>
                              {book.id} - {book.title}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="bindRow">
                        <span>赛道</span>
                        <select
                          value={activePasteGroup.track}
                          onChange={(e) => updateGroupTrack(activePasteGroup.id, e.target.value)}
                          disabled={attributes.length > 0 && !activePasteGroup.attribute}
                        >
                          <option value="">
                            {attributes.length > 0 && !activePasteGroup.attribute ? "先选择属性后再选择赛道" : "选择赛道"}
                          </option>
                          {tracksForAttribute(activePasteGroup.attribute).map((track) => (
                            <option key={track} value={track}>
                              {track}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="bindRow">
                        <span>提示词</span>
                        <select
                          value={activePasteGroup.promptId || ""}
                          onChange={(e) => updateGroupPrompt(activePasteGroup.id, Number(e.target.value))}
                          disabled={attributes.length > 0 && !activePasteGroup.attribute}
                        >
                          <option value="">
                            {!activePasteGroup.attribute
                              ? "先选择属性后再选择提示词"
                              : activePasteGroup.track
                                ? "选择提示词"
                                : "先选择赛道后再选择提示词"}
                          </option>
                          {promptsForTrack(activePasteGroup.attribute, activePasteGroup.track).map((prompt) => (
                            <option key={prompt.id} value={prompt.id}>
                              [{prompt.track}] {prompt.name}
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
                        <button type="button" onClick={copyCurrentPasteGroup} disabled={loading || activePasteGroup.images.length === 0}>复制本组</button>
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
              ) : (
                <div className="stack">
                  <div className="pasteGroupList">
                    {customGroups.map((group) => (
                      <button
                        key={group.id}
                        type="button"
                        className={group.id === activeCustomGroupId ? "groupChip active" : "groupChip"}
                        onClick={() => setActiveCustomGroupId(group.id)}
                      >
                        {group.name || "未命名任务"}
                      </button>
                    ))}
                  </div>
                  {activeCustomGroup ? (
                    <>
                      <div className="bindRow">
                        <span>任务名称</span>
                        <input
                          value={activeCustomGroup.name}
                          onChange={(e) => updateCustomGroup(activeCustomGroup.id, { name: e.target.value })}
                          placeholder="可手动修改任务名"
                        />
                      </div>
                      {attributes.length > 0 ? (
                        <div className="bindRow">
                          <span>属性</span>
                          <select
                            value={activeCustomGroup.attribute}
                            onChange={(e) => updateCustomGroup(activeCustomGroup.id, { attribute: e.target.value })}
                          >
                            <option value="">选择属性（必选）</option>
                            {attributes.map((attribute) => (
                              <option key={attribute} value={attribute}>
                                {displayAttribute(attribute)}
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : null}
                      <div className="bindRow">
                        <span>绑定书稿</span>
                        <select
                          value={activeCustomGroup.bookId || ""}
                          onChange={(e) => updateCustomGroup(activeCustomGroup.id, { bookId: Number(e.target.value) || undefined })}
                          disabled={attributes.length > 0 && !activeCustomGroup.attribute}
                        >
                          <option value="">
                            {attributes.length > 0 && !activeCustomGroup.attribute ? "先选择属性后再选择书稿" : "选择书稿"}
                          </option>
                          {booksForAttribute(activeCustomGroup.attribute).map((book) => (
                            <option key={book.id} value={book.id}>
                              {book.id} - {book.title}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="bindRow">
                        <span>提示词</span>
                        <select
                          value={activeCustomGroup.promptId || ""}
                          onChange={(e) => updateCustomGroup(activeCustomGroup.id, { promptId: Number(e.target.value) || undefined })}
                          disabled={attributes.length > 0 && !activeCustomGroup.attribute}
                        >
                          <option value="">
                            {attributes.length > 0 && !activeCustomGroup.attribute
                              ? "先选择属性后再选择提示词"
                              : "选择提示词"}
                          </option>
                          {promptsForAttribute(activeCustomGroup.attribute).map((p) => (
                            <option key={p.id} value={p.id}>
                              [{p.track}] {p.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="bindRow">
                        <span>标题</span>
                        <input
                          value={activeCustomGroup.title}
                          onChange={(e) => updateCustomGroup(activeCustomGroup.id, { title: e.target.value })}
                          placeholder="请输入标题"
                        />
                      </div>
                      <textarea
                        rows={10}
                        value={activeCustomGroup.pointsText}
                        onChange={(e) => updateCustomGroup(activeCustomGroup.id, { pointsText: e.target.value })}
                        placeholder={"请输入分点观点，一行一个分点"}
                      />
                      <div className="actions">
                        <button type="button" onClick={onCompleteCurrentCustomGroup} disabled={loading}>完成本组并新建下一组</button>
                        <button
                          type="button"
                          onClick={copyCurrentCustomGroup}
                          disabled={loading || (!activeCustomGroup.title.trim() && !activeCustomGroup.pointsText.trim())}
                        >
                          复制本组
                        </button>
                        <button type="button" onClick={() => removeCustomGroup(activeCustomGroup.id)} disabled={loading}>删除本组</button>
                      </div>
                      <p className="empty">可提交任务数：{submitReadyCustomGroups.length}</p>
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
