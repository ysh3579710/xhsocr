# 精选笔记 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增“精选笔记”模块，支持从成功任务入库、手动录入、编辑管理，以及从精选笔记发起仿写/原创/框架原创二次创作。

**Architecture:** 后端新增 `featured_notes` 独立数据表与 API，不改动原有任务主链路；原任务模块只增加“精选/已精选”和标题搜索。精选笔记二次创作通过变量映射复用现有三类任务创建接口和提示词，不要求用户修改提示词内容。

**Tech Stack:** FastAPI, SQLAlchemy, PostgreSQL/Alembic, Next.js, TypeScript

---

## 文件范围

**后端**
- `backend/app/models/entities.py`
- `backend/app/models/__init__.py`
- `backend/app/schemas/featured_notes.py`（新建）
- `backend/app/api/featured_notes.py`（新建）
- `backend/app/api/tasks.py`
- `backend/app/main.py`
- `backend/alembic/versions/0011_featured_notes.py`（新建）

**前端**
- `frontend/app/layout.tsx`
- `frontend/app/tasks/page.tsx`
- `frontend/app/tasks/[id]/page.tsx`
- `frontend/app/create-tasks/page.tsx`
- `frontend/app/create-tasks/[id]/page.tsx`
- `frontend/app/framework-tasks/page.tsx`
- `frontend/app/framework-tasks/[id]/page.tsx`
- `frontend/app/featured-notes/page.tsx`（新建）
- `frontend/app/featured-notes/[id]/page.tsx`（新建）
- `frontend/lib/api.ts`

## 实施步骤

### 第 1 步：定义精选笔记数据结构与基础接口
- 新增 `featured_notes` 表，字段包含：
  - `source_task_type`
  - `source_task_id`
  - `title`
  - `content`
  - `is_manual`
  - `structured_title`
  - `structured_points_text`
  - `structured_outline`
  - `created_at`
  - `updated_at`
- 新增 Alembic 迁移。
- 新增基础 API：
  - 列表
  - 详情
  - 手动新建
  - 编辑
  - 删除

### 第 2 步：打通任务与精选库的关联
- 在仿写任务、原创创作、原创创作（框架）中增加“精选/已精选”状态接口。
- 成功任务加入精选时的标题规则：
  - 仿写：最终文本第一行
  - 原创：优先 `task.title`，为空回退最终文本第一行
  - 框架原创：优先结构化标题，回退最终文本第一行
- 框架原创来源需要额外快照保存：
  - `structured_title`
  - `structured_points_text`
  - `structured_outline`
- 再次点击 `已精选` 时取消精选。

### 第 3 步：新增精选笔记列表与详情页面
- 增加左侧菜单“精选笔记”。
- 列表页支持：
  - 展示来源类型、标题、创建时间
  - 前端按标题搜索
  - 手动新建精选
- 手动新建采用单文本框：
  - 第一行 = 标题
  - 其余内容 = 正文
- 详情页支持：
  - 查看标题/正文
  - 编辑
  - 删除

### 第 4 步：在原任务列表与详情接入精选按钮
- 三个任务列表中，对成功任务增加“精选/已精选”按钮。
- 三个任务详情页顶部同样增加“精选/已精选”按钮。
- 状态展示与列表、详情保持一致。

### 第 5 步：实现从精选笔记发起二次创作
- 精选详情页提供 3 个入口：
  - 二次仿写
  - 二次原创
  - 二次框架原创
- 二次仿写：
  - 精选正文映射为 `{original_note}`
  - 仍要求选择书稿和提示词
- 二次原创：
  - 默认标题 = 精选正文第一行
  - 允许用户修改
  - 兼容现有 `{title}` 提示词变量
- 二次框架原创：
  - 如果精选笔记已有结构化快照，直接复用
  - 如果没有，则再走内部提取标题/分点
  - 兼容现有 `{title}` / `{points}` / `{outline}` 变量
- 新建出的任务分别进入原有对应模块列表，不新增新的任务类型分类。

### 第 6 步：给三类任务列表加标题搜索
- 仿写任务：
  - 按最终文本第一行过滤
- 原创创作：
  - 按 `task.title` 过滤
- 原创创作（框架）：
  - 优先结构化标题，回退最终文本第一行
- 本阶段先做前端搜索，不改后端分页/查询接口。

## 验证重点

- 精选库不会影响原有三种任务的创建、执行、详情、下载逻辑。
- 同一任务可在列表与详情页正确切换“精选/已精选”。
- 手动创建精选笔记后可正确显示标题与正文。
- 从精选发起二次仿写/原创/框架原创后，任务进入正确模块。
- 原有三个提示词：
  - `教师赛道（仿写）`
  - `教师赛道（原创）`
  - `教师赛道（框架原创）`
  无需修改即可继续使用。
