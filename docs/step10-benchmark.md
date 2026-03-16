# Step 10 并发与稳定性验证报告

日期：2026-03-12  
环境：本机（PostgreSQL + Redis），`OCR_PROVIDER=mock`，`LLM_PROVIDER=mock`

## 测试目标

- 验证系统能稳定处理“同时创建 20 个任务”的最小并发目标。
- 验证任务成功率、吞吐与状态流转稳定性。

## 测试方法

- 使用脚本：`scripts/benchmark_step10.py`
- 一次性创建 20 个目录任务（单图），自动入队
- 使用 RQ `SimpleWorker` 并发消费（避免 macOS fork 崩溃）
- 统计：总耗时、成功/失败数、吞吐（tasks/sec）

## 测试结果

1) 基线（推荐）
- 参数：`--tasks 20 --workers 6`
- 结果：
  - `success_count=20`
  - `failed_count=0`
  - `elapsed_seconds=1.824`
  - `throughput_tasks_per_sec=10.963`

2) 对比
- 参数：`--tasks 20 --workers 10`
- 结果：
  - `success_count=20`
  - `failed_count=0`
  - `elapsed_seconds=2.475`
  - `throughput_tasks_per_sec=8.081`

## 结论

- 在 mock 模式下，系统满足“20 并发任务可稳定处理”的 MVP 目标。
- 本机上 `workers=6` 明显优于 `workers=10`（更高吞吐），说明 worker 并非越多越好。

## 建议参数（当前环境）

- `RQ workers`: 6（基线建议）
- `OCR_PROVIDER`: `mock`（压测）/ `paddleocr`（真实）
- `LLM_PROVIDER`: `mock`（压测）/ `openrouter`（真实）

## 注意事项

- 该结果是“功能链路并发基线”，不是“真实 OCR + 真实模型成本/时延”上限。
- 切换 `paddleocr + openrouter` 后，需要重新做压测并单独给出生产参数。
