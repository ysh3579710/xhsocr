"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../lib/api";
import { FixedTagsConfig, LLMModelConfig, PromptTemplate, PromptVersion, Tag } from "../../lib/types";

export default function PromptsPage() {
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [versions, setVersions] = useState<PromptVersion[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(null);
  const [newTplType, setNewTplType] = useState("rewrite");
  const [newTplName, setNewTplName] = useState("");
  const [newVerContent, setNewVerContent] = useState("");
  const [newVerActivate, setNewVerActivate] = useState(true);
  const [editingVersionId, setEditingVersionId] = useState<number | null>(null);
  const [editingContent, setEditingContent] = useState("");
  const [fixedTags, setFixedTags] = useState<string[]>(["", "", "", "", ""]);
  const [floatingTags, setFloatingTags] = useState<Tag[]>([]);
  const [newFloatingTag, setNewFloatingTag] = useState("");
  const [activeModel, setActiveModel] = useState("openai/gpt-5-mini");
  const [supportedModels, setSupportedModels] = useState<string[]>(["openai/gpt-5-mini", "openai/gpt-5.3-chat"]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const selectedVersion = useMemo(
    () => versions.find((v) => v.id === selectedVersionId) || null,
    [versions, selectedVersionId]
  );

  const activeByType = useMemo(() => {
    const map: Record<string, PromptTemplate | null> = {
      rewrite: null,
      intro: null,
      tag: null
    };
    for (const t of templates) {
      if (!map[t.prompt_type] && t.active_version_no) {
        map[t.prompt_type] = t;
      }
    }
    return map;
  }, [templates]);

  async function loadTemplates() {
    const data = await apiFetch<PromptTemplate[]>("/prompts/templates");
    setTemplates(data);
    if (data.length === 0) {
      setSelectedTemplateId(null);
      return;
    }
    if (!selectedTemplateId || !data.some((t) => t.id === selectedTemplateId)) {
      setSelectedTemplateId(data[0].id);
    }
  }

  async function loadVersions(templateId: number) {
    const data = await apiFetch<PromptVersion[]>(`/prompts/templates/${templateId}/versions`);
    setVersions(data);
    if (data.length === 0) {
      setSelectedVersionId(null);
      return;
    }
    setSelectedVersionId(data[0].id);
  }

  async function loadTags() {
    const [fixed, floating] = await Promise.all([
      apiFetch<FixedTagsConfig>("/tags/fixed"),
      apiFetch<Tag[]>("/tags")
    ]);
    setFixedTags(fixed.fixed_tags);
    setFloatingTags(floating);
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
      await Promise.all([loadTemplates(), loadTags(), loadLLMModel()]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

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

  useEffect(() => {
    void loadAll();
  }, []);

  useEffect(() => {
    if (!selectedTemplateId) {
      setVersions([]);
      setSelectedVersionId(null);
      return;
    }
    void loadVersions(selectedTemplateId);
  }, [selectedTemplateId]);

  async function onCreateTemplate(e: FormEvent) {
    e.preventDefault();
    if (!newTplName.trim()) return;
    setLoading(true);
    setError("");
    try {
      await apiFetch("/prompts/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt_type: newTplType, name: newTplName.trim() })
      });
      setNewTplName("");
      await loadTemplates();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function onDeleteTemplate(templateId: number) {
    const ok = window.confirm(`确认删除模板 #${templateId} 吗？模板下所有版本会一起删除。`);
    if (!ok) return;
    setLoading(true);
    setError("");
    try {
      await apiFetch(`/prompts/templates/${templateId}`, { method: "DELETE" });
      await loadTemplates();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function onCreateVersion(e: FormEvent) {
    e.preventDefault();
    if (!selectedTemplateId || !newVerContent.trim()) return;
    setLoading(true);
    setError("");
    try {
      await apiFetch(`/prompts/templates/${selectedTemplateId}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: newVerContent.trim(), activate: newVerActivate })
      });
      setNewVerContent("");
      await loadTemplates();
      await loadVersions(selectedTemplateId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function onActivateVersion(versionId: number) {
    if (!selectedTemplateId) return;
    setLoading(true);
    setError("");
    try {
      await apiFetch(`/prompts/templates/${selectedTemplateId}/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version_id: versionId })
      });
      await loadTemplates();
      await loadVersions(selectedTemplateId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function onStartEditVersion(versionId: number) {
    const ver = versions.find((v) => v.id === versionId);
    if (!ver) return;
    setSelectedVersionId(versionId);
    setEditingVersionId(versionId);
    setEditingContent(ver.content);
  }

  function onCancelEditVersion() {
    setEditingVersionId(null);
    setEditingContent("");
  }

  async function onSaveEditVersion() {
    if (!selectedTemplateId || !editingVersionId || !editingContent.trim()) return;
    setLoading(true);
    setError("");
    try {
      await apiFetch(`/prompts/templates/${selectedTemplateId}/versions/${editingVersionId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editingContent.trim() })
      });
      await loadVersions(selectedTemplateId);
      setEditingVersionId(null);
      setEditingContent("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function onSaveFixedTags(e: FormEvent) {
    e.preventDefault();
    if (fixedTags.some((t) => !t.trim())) {
      setError("固定标签必须填写5个且不能为空。");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const payload = { fixed_tags: fixedTags.map((t) => t.trim().replace(/^#/, "")) };
      const data = await apiFetch<FixedTagsConfig>("/tags/fixed", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      setFixedTags(data.fixed_tags);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function onCreateFloatingTag(e: FormEvent) {
    e.preventDefault();
    if (!newFloatingTag.trim()) return;
    setLoading(true);
    setError("");
    try {
      await apiFetch("/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag_text: newFloatingTag.trim().replace(/^#/, ""), enabled: true })
      });
      setNewFloatingTag("");
      await loadTags();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function onToggleTag(tag: Tag) {
    setLoading(true);
    setError("");
    try {
      await apiFetch(`/tags/${tag.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !tag.enabled })
      });
      await loadTags();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function onDeleteTag(tag: Tag) {
    const ok = window.confirm(`确认删除标签 #${tag.tag_text} 吗？`);
    if (!ok) return;
    setLoading(true);
    setError("");
    try {
      await apiFetch(`/tags/${tag.id}`, { method: "DELETE" });
      await loadTags();
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
          <h1>Prompt 配置中心</h1>
          <p>管理模板、版本、启用状态与标签配置</p>
        </div>
        <button onClick={() => void loadAll()} disabled={loading}>刷新</button>
      </header>

      {error ? <div className="errorBox">{error}</div> : null}

      <section className="card">
        <h2>模型配置（全局单选）</h2>
        <form onSubmit={onSaveActiveModel} className="rowHeader">
          <select value={activeModel} onChange={(e) => setActiveModel(e.target.value)}>
            {supportedModels.map((model) => (
              <option key={model} value={model}>{model}</option>
            ))}
          </select>
          <button type="submit" disabled={loading}>保存生效模型</button>
        </form>
        <p>切换后仅对新提交/新重试任务生效，运行中与已完成任务不变。</p>
      </section>

      <section className="card">
        <h2>当前生效模板（按类型）</h2>
        <p>
          模型：{activeModel}
        </p>
        <p>
          rewrite：{activeByType.rewrite ? `#${activeByType.rewrite.id} / v${activeByType.rewrite.active_version_no}` : "未配置"}
          {" | "}
          intro：{activeByType.intro ? `#${activeByType.intro.id} / v${activeByType.intro.active_version_no}` : "未配置"}
          {" | "}
          tag：{activeByType.tag ? `#${activeByType.tag.id} / v${activeByType.tag.active_version_no}` : "未配置"}
        </p>
      </section>

      <section className="card">
        <h2>创建模板</h2>
        <form onSubmit={onCreateTemplate} className="stack">
          <select value={newTplType} onChange={(e) => setNewTplType(e.target.value)}>
            <option value="rewrite">rewrite</option>
            <option value="intro">intro</option>
            <option value="tag">tag</option>
            <option value="fusion">fusion</option>
          </select>
          <input value={newTplName} onChange={(e) => setNewTplName(e.target.value)} placeholder="模板名" />
          <button type="submit" disabled={loading}>创建模板</button>
        </form>
      </section>

      <section className="card">
        <h2>模板列表</h2>
        <div className="table">
          <div className="thead">
            <span>ID</span>
            <span>类型</span>
            <span>名称</span>
            <span>当前启用</span>
            <span>操作</span>
          </div>
          {templates.map((t) => (
            <div
              key={t.id}
              className={`trow clickable ${selectedTemplateId === t.id ? "active" : ""}`}
              onClick={() => setSelectedTemplateId(t.id)}
            >
              <span>{t.id}</span>
              <span>{t.prompt_type}</span>
              <span>{t.name}</span>
              <span>{t.active_version_no ? `v${t.active_version_no}` : "-"}</span>
              <span>
                <button onClick={(e) => { e.stopPropagation(); void onDeleteTemplate(t.id); }} disabled={loading}>
                  删除
                </button>
              </span>
            </div>
          ))}
          {templates.length === 0 ? <p className="empty">暂无模板</p> : null}
        </div>
      </section>

      <section className="card">
        <h2>版本管理 {selectedTemplateId ? `(Template #${selectedTemplateId})` : ""}</h2>
        {selectedTemplateId ? (
          <>
            <form onSubmit={onCreateVersion} className="stack">
              <textarea
                rows={6}
                value={newVerContent}
                onChange={(e) => setNewVerContent(e.target.value)}
                placeholder="Prompt 内容，可包含变量：{original_note} / {rewritten_note} / {book_title} / {matched_segments}"
              />
              <label className="checkbox">
                <input type="checkbox" checked={newVerActivate} onChange={(e) => setNewVerActivate(e.target.checked)} />
                创建后立即启用
              </label>
              <button type="submit" disabled={loading}>新增版本</button>
            </form>

            <div className="table">
              <div className="thead">
                <span>ID</span>
                <span>版本号</span>
                <span>状态</span>
                <span>操作</span>
              </div>
              {versions.map((v) => (
                <div key={v.id} className={`trow ${selectedVersionId === v.id ? "active" : ""}`}>
                  <span>{v.id}</span>
                  <span>v{v.version_no}</span>
                  <span>{v.is_active ? "active" : "inactive"}</span>
                  <span className="actions">
                    <button onClick={() => setSelectedVersionId(v.id)} disabled={loading}>查看内容</button>
                    <button onClick={() => onStartEditVersion(v.id)} disabled={loading}>编辑</button>
                    <button onClick={() => void onActivateVersion(v.id)} disabled={loading}>启用/回滚</button>
                  </span>
                </div>
              ))}
              {versions.length === 0 ? <p className="empty">当前模板暂无版本</p> : null}
            </div>
            {editingVersionId ? (
              <div className="stack">
                <label>编辑版本内容（Version #{editingVersionId}）</label>
                <textarea rows={10} value={editingContent} onChange={(e) => setEditingContent(e.target.value)} />
                <div className="actions">
                  <button onClick={() => void onSaveEditVersion()} disabled={loading}>保存修改</button>
                  <button onClick={() => onCancelEditVersion()} disabled={loading}>取消编辑</button>
                </div>
              </div>
            ) : (
              <textarea rows={10} readOnly value={selectedVersion?.content || ""} placeholder="点击“查看内容”查看该版本 Prompt 详情" />
            )}
          </>
        ) : (
          <p className="empty">请先选择一个模板</p>
        )}
      </section>

      <section className="card">
        <h2>固定标签配置（固定5个）</h2>
        <form onSubmit={onSaveFixedTags} className="stack">
          {fixedTags.map((tag, idx) => (
            <input
              key={idx}
              value={tag}
              onChange={(e) => {
                const next = [...fixedTags];
                next[idx] = e.target.value;
                setFixedTags(next);
              }}
              placeholder={`固定标签 ${idx + 1}`}
            />
          ))}
          <button type="submit" disabled={loading}>保存固定标签</button>
        </form>
      </section>

      <section className="card">
        <h2>浮动标签池（随机10个来源）</h2>
        <form onSubmit={onCreateFloatingTag} className="rowHeader">
          <input value={newFloatingTag} onChange={(e) => setNewFloatingTag(e.target.value)} placeholder="新增标签，例如：班主任日常" />
          <button type="submit" disabled={loading}>新增标签</button>
        </form>
        <div className="table">
          <div className="thead">
            <span>ID</span>
            <span>标签</span>
            <span>启用</span>
            <span>操作</span>
          </div>
          {floatingTags.map((tag) => (
            <div key={tag.id} className="trow">
              <span>{tag.id}</span>
              <span>#{tag.tag_text}</span>
              <span>{tag.enabled ? "是" : "否"}</span>
              <span className="actions">
                <button onClick={() => void onToggleTag(tag)} disabled={loading}>
                  {tag.enabled ? "禁用" : "启用"}
                </button>
                <button onClick={() => void onDeleteTag(tag)} disabled={loading}>删除</button>
              </span>
            </div>
          ))}
          {floatingTags.length === 0 ? <p className="empty">暂无标签</p> : null}
        </div>
      </section>
    </div>
  );
}
