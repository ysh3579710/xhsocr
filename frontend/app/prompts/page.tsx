"use client";

import { FormEvent, useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import { LLMModelConfig, PromptItem } from "../../lib/types";

type PromptFormState = {
  track: string;
  name: string;
  content: string;
  enabled: boolean;
  llm_model: string;
  attribute: string;
};

const EMPTY_FORM: PromptFormState = {
  track: "",
  name: "",
  content: "",
  enabled: true,
  llm_model: "",
  attribute: ""
};

const MODEL_LABELS: Record<string, string> = {
  "openai/gpt-5-mini": "openai/gpt-5-mini",
  "openai/gpt-5.3-chat": "openai/gpt-5.3-chat",
  "claude-sonnet-4.6": "claude-sonnet-4.6",
  "google/gemini-3-flash-preview": "Gemini 3 Flash Preview"
};

export default function PromptsPage() {
  const [prompts, setPrompts] = useState<PromptItem[]>([]);
  const [tracks, setTracks] = useState<string[]>([]);
  const [attributes, setAttributes] = useState<string[]>([]);
  const [editingPromptId, setEditingPromptId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<PromptFormState>(EMPTY_FORM);
  const [createForm, setCreateForm] = useState<PromptFormState>(EMPTY_FORM);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);

  const [filterTrack, setFilterTrack] = useState("");
  const [filterEnabled, setFilterEnabled] = useState("all");
  const [filterKeyword, setFilterKeyword] = useState("");
  const [filterAttribute, setFilterAttribute] = useState("");

  const [activeModel, setActiveModel] = useState("openai/gpt-5-mini");
  const [supportedModels, setSupportedModels] = useState<string[]>([
    "openai/gpt-5-mini",
    "openai/gpt-5.3-chat",
    "claude-sonnet-4.6",
    "google/gemini-3-flash-preview"
  ]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function buildPromptListPath() {
    const qs = new URLSearchParams();
    if (filterTrack) qs.set("track", filterTrack);
    if (filterAttribute) qs.set("attribute", filterAttribute);
    if (filterEnabled === "enabled") qs.set("enabled", "true");
    if (filterEnabled === "disabled") qs.set("enabled", "false");
    if (filterKeyword.trim()) qs.set("q", filterKeyword.trim());
    const suffix = qs.toString();
    return suffix ? `/prompts?${suffix}` : "/prompts";
  }

  async function loadPrompts() {
    const data = await apiFetch<PromptItem[]>(buildPromptListPath());
    setPrompts(data);
    if (data.length === 0) {
      setEditForm(EMPTY_FORM);
      return;
    }
  }

  async function loadTracks() {
    const data = await apiFetch<string[]>("/prompts/tracks");
    setTracks(data);
  }

  async function loadAttributes() {
    const data = await apiFetch<string[]>("/prompts/attributes");
    setAttributes(data);
  }

  async function loadLLMModel() {
    const data = await apiFetch<LLMModelConfig>("/prompts/llm-model");
    setActiveModel(data.active_model);
    setSupportedModels(data.supported_models || []);
  }

  async function loadAll() {
    setLoading(true);
    setError("");
    try {
      await Promise.all([loadPrompts(), loadTracks(), loadAttributes(), loadLLMModel()]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  useEffect(() => {
    void loadPrompts();
  }, [filterTrack, filterEnabled, filterKeyword, filterAttribute]);

  async function onSaveActiveModel(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch<LLMModelConfig>("/prompts/llm-model", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active_model: activeModel })
      });
      setActiveModel(data.active_model);
      setSupportedModels(data.supported_models || []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function openCreateModal() {
    setCreateForm(EMPTY_FORM);
    setError("");
    setIsCreateOpen(true);
  }

  function closeCreateModal() {
    setIsCreateOpen(false);
  }

  async function onCreatePrompt(e: FormEvent) {
    e.preventDefault();
    if (!createForm.track.trim() || !createForm.name.trim() || !createForm.content.trim()) {
      setError("赛道、名称、内容都不能为空。");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const created = await apiFetch<PromptItem>("/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          track: createForm.track.trim(),
          name: createForm.name.trim(),
          content: createForm.content,
          enabled: createForm.enabled,
          llm_model: createForm.llm_model || null,
          attribute: createForm.attribute || null,
        })
      });
      setEditingPromptId(created.id);
      setIsCreateOpen(false);
      await Promise.all([loadPrompts(), loadTracks(), loadAttributes()]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function onUpdatePrompt(e: FormEvent) {
    e.preventDefault();
    if (!editingPromptId) return;
    if (!editForm.track.trim() || !editForm.name.trim() || !editForm.content.trim()) {
      setError("赛道、名称、内容都不能为空。");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await apiFetch<PromptItem>(`/prompts/${editingPromptId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          track: editForm.track.trim(),
          name: editForm.name.trim(),
          content: editForm.content,
          enabled: editForm.enabled,
          llm_model: editForm.llm_model || null,
          attribute: editForm.attribute || null,
        })
      });
      setIsEditOpen(false);
      await Promise.all([loadPrompts(), loadTracks(), loadAttributes()]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function onTogglePromptEnabled(prompt: PromptItem) {
    setLoading(true);
    setError("");
    try {
      await apiFetch<PromptItem>(`/prompts/${prompt.id}/${prompt.enabled ? "disable" : "enable"}`, {
        method: "POST"
      });
      await loadPrompts();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function onDeletePrompt(prompt: PromptItem) {
    const ok = window.confirm(`确认删除提示词 #${prompt.id}「${prompt.name}」吗？`);
    if (!ok) return;
    setLoading(true);
    setError("");
    try {
      await apiFetch(`/prompts/${prompt.id}`, { method: "DELETE" });
      await Promise.all([loadPrompts(), loadTracks(), loadAttributes()]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function openEditModal(prompt: PromptItem) {
    setEditingPromptId(prompt.id);
    setEditForm({
      track: prompt.track,
      name: prompt.name,
      content: prompt.content,
      enabled: prompt.enabled,
      llm_model: prompt.llm_model || "",
      attribute: prompt.attribute || ""
    });
    setError("");
    setIsEditOpen(true);
  }

  function closeEditModal() {
    setIsEditOpen(false);
  }

  return (
    <div className="pageWrap">
      <header className="pageHeader rowHeader">
        <div>
          <h1>Prompt 配置中心</h1>
          <p>管理全局模型与提示词（赛道/名称/内容）</p>
        </div>
        <button onClick={() => void loadAll()} disabled={loading}>刷新</button>
      </header>

      {error ? <div className="errorBox">{error}</div> : null}

      <section className="card">
        <h2>默认模型配置（当提示词未绑定模型时生效）</h2>
        <form onSubmit={onSaveActiveModel} className="rowHeader">
          <select value={activeModel} onChange={(e) => setActiveModel(e.target.value)}>
            {supportedModels.map((model) => (
              <option key={model} value={model}>{MODEL_LABELS[model] || model}</option>
            ))}
          </select>
          <button type="submit" disabled={loading}>保存生效模型</button>
        </form>
        <p>切换后仅对新提交/新重试任务生效，运行中与已完成任务不变。</p>
      </section>

      <section className="card">
        <h2>提示词筛选</h2>
        <div className="rowHeader">
              <select value={filterTrack} onChange={(e) => setFilterTrack(e.target.value)}>
            <option value="">全部赛道</option>
            {tracks.map((track) => (
              <option key={track} value={track}>{track}</option>
            ))}
          </select>
          <select value={filterAttribute} onChange={(e) => setFilterAttribute(e.target.value)}>
            <option value="">全部属性</option>
            {attributes.map((attribute) => (
              <option key={attribute} value={attribute}>{attribute}</option>
            ))}
          </select>
          <select value={filterEnabled} onChange={(e) => setFilterEnabled(e.target.value)}>
            <option value="all">全部状态</option>
            <option value="enabled">仅启用</option>
            <option value="disabled">仅禁用</option>
          </select>
          <input
            value={filterKeyword}
            onChange={(e) => setFilterKeyword(e.target.value)}
            placeholder="按名称关键字筛选"
          />
          <button type="button" onClick={() => { setFilterTrack(""); setFilterAttribute(""); setFilterEnabled("all"); setFilterKeyword(""); }}>
            重置
          </button>
        </div>
      </section>

      <section className="card">
        <div className="rowHeader">
          <h2>提示词列表</h2>
          <button type="button" onClick={openCreateModal}>新建提示词</button>
        </div>
        <div className="table">
          <div className="thead trow8">
            <span>ID</span>
            <span>赛道</span>
            <span>属性</span>
            <span>名称</span>
            <span>模型</span>
            <span>状态</span>
            <span>更新时间</span>
            <span>操作</span>
          </div>
          {prompts.map((prompt) => (
            <div
              key={prompt.id}
              className="trow trow8"
            >
              <span>{prompt.id}</span>
              <span>{prompt.track}</span>
              <span>{prompt.attribute || "-"}</span>
              <span>{prompt.name}</span>
              <span>{prompt.llm_model ? MODEL_LABELS[prompt.llm_model] || prompt.llm_model : "默认"}</span>
              <span>{prompt.enabled ? "启用" : "禁用"}</span>
              <span>{prompt.updated_at.replace("T", " ").slice(0, 19)}</span>
              <span className="actions">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); openEditModal(prompt); }}
                  disabled={loading}
                >
                  编辑
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); void onTogglePromptEnabled(prompt); }}
                  disabled={loading}
                >
                  {prompt.enabled ? "禁用" : "启用"}
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); void onDeletePrompt(prompt); }}
                  disabled={loading}
                >
                  删除
                </button>
              </span>
            </div>
          ))}
          {prompts.length === 0 ? <p className="empty">暂无提示词</p> : null}
        </div>
      </section>

      <datalist id="prompt-track-options">
        {tracks.map((track) => (
          <option key={track} value={track} />
        ))}
      </datalist>
      <datalist id="prompt-attribute-options">
        {attributes.map((attribute) => (
          <option key={attribute} value={attribute} />
        ))}
      </datalist>

      {isCreateOpen ? (
        <div className="modalMask" onClick={closeCreateModal}>
          <div className="modalCard" onClick={(e) => e.stopPropagation()}>
            <div className="rowHeader">
              <h2>新建提示词</h2>
              <button type="button" onClick={closeCreateModal}>关闭</button>
            </div>
            <form onSubmit={onCreatePrompt} className="stack">
              <div className="bindRow">
                <span>赛道（可选已有或直接输入新赛道）</span>
                <input
                  list="prompt-track-options"
                  value={createForm.track}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, track: e.target.value }))}
                  placeholder="例如：教师赛道"
                />
              </div>
              <div className="bindRow">
                <span>提示词名称</span>
                <input
                  value={createForm.name}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="请输入提示词名称"
                />
              </div>
              <div className="bindRow">
                <span>属性（可选）</span>
                <input
                  list="prompt-attribute-options"
                  value={createForm.attribute}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, attribute: e.target.value }))}
                  placeholder="例如：情感分析"
                />
              </div>
              <div className="bindRow">
                <span>绑定模型</span>
                <select
                  value={createForm.llm_model}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, llm_model: e.target.value }))}
                >
                  <option value="">默认（使用全局模型）</option>
                  {supportedModels.map((model) => (
                    <option key={model} value={model}>{MODEL_LABELS[model] || model}</option>
                  ))}
                </select>
              </div>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={createForm.enabled}
                  onChange={(e) => setCreateForm((prev) => ({ ...prev, enabled: e.target.checked }))}
                />
                启用状态（勾选=启用）
              </label>
              <textarea
                rows={12}
                value={createForm.content}
                onChange={(e) => setCreateForm((prev) => ({ ...prev, content: e.target.value }))}
                placeholder="提示词内容。可包含变量：{title} {original_note} {book_title} {matched_segments} {rewritten_note}"
              />
              <div className="actions">
                <button type="submit" disabled={loading}>创建提示词</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {isEditOpen ? (
        <div className="modalMask" onClick={closeEditModal}>
          <div className="modalCard" onClick={(e) => e.stopPropagation()}>
            <div className="rowHeader">
              <h2>{editingPromptId ? `编辑提示词 #${editingPromptId}` : "编辑提示词"}</h2>
              <button type="button" onClick={closeEditModal}>关闭</button>
            </div>
            <form onSubmit={onUpdatePrompt} className="stack">
              <div className="bindRow">
                <span>赛道（可选已有或直接输入新赛道）</span>
                <input
                  list="prompt-track-options"
                  value={editForm.track}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, track: e.target.value }))}
                  placeholder="例如：教师赛道"
                />
              </div>
              <div className="bindRow">
                <span>提示词名称</span>
                <input
                  value={editForm.name}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="请输入提示词名称"
                />
              </div>
              <div className="bindRow">
                <span>属性（可选）</span>
                <input
                  list="prompt-attribute-options"
                  value={editForm.attribute}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, attribute: e.target.value }))}
                  placeholder="例如：情感分析"
                />
              </div>
              <div className="bindRow">
                <span>绑定模型</span>
                <select
                  value={editForm.llm_model}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, llm_model: e.target.value }))}
                >
                  <option value="">默认（使用全局模型）</option>
                  {supportedModels.map((model) => (
                    <option key={model} value={model}>{MODEL_LABELS[model] || model}</option>
                  ))}
                </select>
              </div>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={editForm.enabled}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, enabled: e.target.checked }))}
                />
                启用状态（勾选=启用）
              </label>
              <textarea
                rows={12}
                value={editForm.content}
                onChange={(e) => setEditForm((prev) => ({ ...prev, content: e.target.value }))}
                placeholder="提示词内容。可包含变量：{title} {original_note} {book_title} {matched_segments} {rewritten_note}"
              />
              <div className="actions">
                <button type="submit" disabled={loading}>保存修改</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
