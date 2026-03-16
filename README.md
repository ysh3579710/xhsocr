# xhsocr MVP

小红书笔记 OCR + 书稿辅助 AI 改写系统（MVP）。

## 当前阶段

当前仓库处于 `Step 10`（并发与稳定性验证）：
- FastAPI 后端骨架
- Next.js 前端骨架
- Alembic 迁移框架
- MVP 初始表结构迁移
- 书稿上传/解析/切片 API
- 标签库 CRUD API
- 任务创建与多目录上传 API
- Redis 队列与 Worker
- 任务状态流转与手动重试
- OCR 流水线（按图片顺序识别并拼接原创笔记）
- BM25 书稿匹配（动态 Top2-3）
- AI 改写/推荐正文/标签生成
- Prompt 配置中心（版本管理、启用、回滚）
- 前端管理台联调页面
- 20并发基线压测脚本与报告

## 技术栈（目标）

- Frontend: Next.js
- Backend: FastAPI
- DB: PostgreSQL
- Queue: Redis + Worker
- OCR: PaddleOCR
- LLM: OpenRouter (OpenAI-compatible API)

## 本地依赖

请先安装并确认以下依赖可用：

- `python3` (建议 3.11+)
- `node` (建议 20+)
- `pnpm` 或 `npm`
- `postgresql` (建议 15+)
- `redis` (建议 7+)
- `libreoffice`（用于后续 docx 兼容处理，非强制）

运行检查脚本：

```bash
bash scripts/check_prereqs.sh
```

## 环境变量

复制模板：

```bash
cp .env.example .env
```

然后填写真实值，尤其是：
- `OPENROUTER_API_KEY`
- `OPENROUTER_BASE_URL`
- `OPENROUTER_MODEL`

## 密钥安全规范

- 禁止将任何真实 API Key 提交到 Git。
- 禁止在 issue/chat/日志中粘贴完整密钥。
- 如密钥已泄露，立即在服务商后台吊销并重建。

## 目录结构

```text
xhsocr/
  backend/
  frontend/
  scripts/
  storage/
  docs/
```

## 下一步（Step 11）

部署与上线准备（容器化、环境隔离、真实 OCR/LLM 压测）。

## Step 1 运行方式

后端：

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

前端：

```bash
cd frontend
npm install
npm run dev
```

## Step 2 API（已可用）

- `POST /books/upload`：上传 `docx` 书稿并自动切片入库
- `GET /books`：查询书稿列表
- `DELETE /books/{id}`：删除书稿
- `POST /tags`：新增标签
- `GET /tags`：查询标签（支持 `enabled` 过滤）
- `PUT /tags/{id}`：更新标签
- `DELETE /tags/{id}`：删除标签

## Step 3 API（已可用）

- `POST /tasks`：多目录图片上传 + 任务创建
  - `bindings`（form）：JSON 数组，格式 `[{\"folder_name\":\"笔记A\",\"book_id\":1}]`
  - `files`（form）：支持多个文件，文件名需带相对路径，如 `笔记A/图1.jpg`
  - `batch_name`（form，可选）：当目录数量 >1 时用于批次命名
- `GET /tasks`：任务列表
- `GET /tasks/{id}`：任务详情（含图片自然排序结果）

## Step 4 API（已可用）

- `POST /tasks`：默认自动入队（可用 `auto_enqueue=false` 关闭）
- `POST /tasks/{id}/retry`：手动重试（重置为 `waiting` 并重新入队）
- `GET /batch`：批次列表
- `GET /batch/{id}`：批次详情

状态流转：
- `waiting -> processing -> success|failed`

Worker 启动方式：

```bash
cd backend
source .venv/bin/activate
python worker.py
```

## Step 5 说明（已可用）

- Worker 执行任务时会按 `task_images.sort_index` 顺序逐张 OCR。
- 每张图 OCR 结果原样保留，不做纠错和清洗。
- 多图结果用换行拼接写入 `task_results.original_note_text`。
- `GET /tasks/{id}` 已返回 `original_note_text`。

OCR 配置：

- 默认：`OCR_PROVIDER=rapidocr_onnxruntime`（本机稳定优先）
- 可选：`OCR_PROVIDER=paddleocr`
- 可联调：`OCR_PROVIDER=mock`
- 单图 OCR 超时：`OCR_TIMEOUT_SECONDS`（默认 90 秒）
- 稳定性隔离（推荐开启）：`OCR_ISOLATE_SUBPROCESS=true`
- 运行时保护：`OCR_ALLOW_UNSTABLE_RUNTIME=false`（默认禁用 macOS + Python<3.10 的不稳定 Paddle 运行）
- macOS 自动降级：`OCR_AUTO_DOWNGRADE_MACOS=true`（默认在 macOS 将 `paddleocr` 自动降级为 `mock`，避免 native 崩溃）

首次运行 PaddleOCR 会自动下载官方模型到本机缓存目录，首次耗时较长，后续会复用缓存。

## Step 6 说明（已可用）

- Worker 在 OCR 完成后执行书稿匹配。
- 使用 `BM25` 对当前任务绑定书稿的 `book_segments` 进行打分。
- 查询词来自原创笔记关键词（关键词不足时回退全量分词）。
- 动态选段规则：
  - 默认返回 Top2
  - 当第3段得分有效且与第2段接近时，返回 Top3
- 匹配结果写入 `task_results.matched_book_segments`，并可通过 `GET /tasks/{id}` 查看。

## Step 7 说明（已可用）

- 在 OCR 与书稿匹配后，任务会继续执行 AI 生成：
  - `rewritten_note`：改写正文
  - `intro_text`：推荐正文（100-150字，不重试；超限只记录 warning）
  - `fixed_tags_text`：固定标签5个
  - `random_tags_text`：从标签库随机选10个
- 最终聚合写入 `task_results.full_output`。
- `GET /tasks/{id}` 已返回以上字段，便于前端直接展示。

LLM 配置：

- 联调模式：`LLM_PROVIDER=mock`
- 实际调用：`LLM_PROVIDER=openrouter`，并设置
  - `OPENROUTER_BASE_URL`
  - `OPENROUTER_API_KEY`
  - `OPENROUTER_MODEL`
  - `LLM_TIMEOUT_SECONDS`（默认 300）
  - `LLM_RETRY_COUNT`（默认 1，超时/连接错误自动重试）
  - `LLM_RETRY_BACKOFF_SECONDS`（默认 1）

## Step 8 API（已可用）

- `POST /prompts/templates`：创建 Prompt 模板（`prompt_type`: rewrite/intro/tag/fusion）
- `GET /prompts/templates`：查询模板及当前启用版本
- `POST /prompts/templates/{template_id}/versions`：新增版本（可选 `activate=true`）
- `GET /prompts/templates/{template_id}/versions`：查询版本列表
- `POST /prompts/templates/{template_id}/activate`：启用指定版本
- `POST /prompts/templates/{template_id}/rollback/{version_id}`：回滚到指定历史版本

任务执行时会优先读取当前启用版本；若未配置启用版本，自动回退到系统内置默认 Prompt。

## Step 9 页面（已可用）

前端首页已集成：
- 书库管理（上传/删除/列表）
- 创建任务（目录上传 + 每目录绑定书稿）
- 任务列表与详情（含 OCR、匹配、AI 结果、复制）
- 批次页（进度统计）
- Prompt 管理（模板、版本、启用）

前端联调环境变量：

```bash
# 推荐留空，默认使用同源代理 /api -> 127.0.0.1:8000
# NEXT_PUBLIC_API_BASE_URL=/api
```

## Step 10 压测（已可用）

运行脚本：

```bash
cd backend
source .venv/bin/activate
python ../scripts/benchmark_step10.py --tasks 20 --workers 6 --timeout 180 --ocr-provider mock --llm-provider mock
```

压测报告：
- `docs/step10-benchmark.md`
