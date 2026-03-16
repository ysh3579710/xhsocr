"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../lib/api";
import { Batch, Task } from "../../lib/types";

export default function BatchesPage() {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const [batchData, taskData] = await Promise.all([
        apiFetch<Batch[]>("/batch"),
        apiFetch<Task[]>("/tasks")
      ]);
      setBatches(batchData);
      setTasks(taskData);
      if (batchData.length > 0 && !selectedBatchId) {
        setSelectedBatchId(batchData[0].id);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  const selectedTasks = useMemo(
    () => tasks.filter((t) => t.batch_id === selectedBatchId),
    [tasks, selectedBatchId]
  );

  return (
    <div className="pageWrap">
      <header className="pageHeader rowHeader">
        <div>
          <h1>批次页</h1>
          <p>查看批次整体进度与子任务执行情况</p>
        </div>
        <button onClick={() => void loadData()} disabled={loading}>刷新</button>
      </header>
      {error ? <div className="errorBox">{error}</div> : null}

      <section className="card">
        <h2>批次列表</h2>
        <div className="table">
          <div className="thead">
            <span>ID</span>
            <span>批次名</span>
            <span>状态</span>
            <span>总数</span>
            <span>成功</span>
            <span>失败</span>
          </div>
          {batches.map((b) => (
            <div
              key={b.id}
              className={`trow clickable ${selectedBatchId === b.id ? "active" : ""}`}
              onClick={() => setSelectedBatchId(b.id)}
            >
              <span>{b.id}</span>
              <span>{b.batch_name}</span>
              <span>{b.status}</span>
              <span>{b.total_count}</span>
              <span>{b.success_count}</span>
              <span>{b.failed_count}</span>
            </div>
          ))}
          {batches.length === 0 ? <p className="empty">暂无批次</p> : null}
        </div>
      </section>

      <section className="card">
        <h2>子任务列表 {selectedBatchId ? `(Batch #${selectedBatchId})` : ""}</h2>
        <div className="table">
          <div className="thead">
            <span>Task ID</span>
            <span>目录名</span>
            <span>书稿ID</span>
            <span>状态</span>
            <span>操作</span>
          </div>
          {selectedTasks.map((t) => (
            <div key={t.id} className="trow">
              <span>{t.id}</span>
              <span>{t.folder_name}</span>
              <span>{t.book_id}</span>
              <span>{t.status}</span>
              <span><Link className="linkBtn" href={`/tasks/${t.id}`}>查看详情</Link></span>
            </div>
          ))}
          {selectedTasks.length === 0 ? <p className="empty">当前批次暂无子任务</p> : null}
        </div>
      </section>
    </div>
  );
}
