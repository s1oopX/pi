import { useState } from "react";
import { useI18n } from "../../i18n";
import * as api from "../../ipc/api";
import { useStore } from "../../store";
import { PRIMARY_TASK_ID } from "../../store/taskRegistry";
import { Icon } from "../Icon";
import { showToast } from "../Toast";
import { buildParallelTaskRows, isPoolFull, poolCap } from "./parallelTasksState";

function errorText(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.split("Error: ").pop()?.trim() || raw;
}

/**
 * Parallel running tasks (M2): one row per backend. Switching rows swaps the
 * conversation without restarting anything; background rows keep streaming
 * and surface unread/completion badges.
 */
export function ParallelTasks() {
  const { t } = useI18n();
  const taskRegistry = useStore((s) => s.taskRegistry);
  const switchActiveTask = useStore((s) => s.switchActiveTask);
  const refreshTasks = useStore((s) => s.refreshTasks);
  const switchingWorkspace = useStore((s) => s.workspaceLoading);
  const [creating, setCreating] = useState(false);
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [switchingId, setSwitchingId] = useState<string | null>(null);

  const rows = buildParallelTaskRows(taskRegistry);
  const poolFull = isPoolFull(taskRegistry);
  const busy = creating || Boolean(stoppingId) || Boolean(switchingId) || switchingWorkspace;

  async function handleCreate() {
    if (busy || poolFull) return;
    setCreating(true);
    try {
      const picked = await api.pickTaskFolder();
      if (picked.canceled || !picked.cwd) return;
      const created = await api.createTask(picked.cwd);
      await refreshTasks();
      await switchActiveTask(created.taskId);
      showToast(
        created.branch
          ? t("Parallel task started on {branch}", "已在分支 {branch} 上启动并行任务", { branch: created.branch })
          : t("Parallel task started in {cwd}", "已在 {cwd} 启动并行任务", { cwd: picked.cwd }),
        "success",
      );
    } catch (error) {
      showToast(t("Could not start the task: {message}", "启动并行任务失败：{message}", {
        message: errorText(error),
      }), "error");
    } finally {
      setCreating(false);
    }
  }

  async function handleSwitch(taskId: string) {
    if (busy || taskId === taskRegistry.activeTaskId) return;
    setSwitchingId(taskId);
    try {
      await switchActiveTask(taskId);
    } finally {
      setSwitchingId(null);
    }
  }

  async function handleStop(taskId: string) {
    if (busy) return;
    setStoppingId(taskId);
    try {
      if (taskRegistry.activeTaskId === taskId) {
        await switchActiveTask(PRIMARY_TASK_ID);
      }
      const result = await api.stopTask(taskId);
      await refreshTasks();
      showToast(
        result.worktreeRemoved === false
          ? t("Task stopped; the worktree has changes and was kept", "任务已停止；工作树有改动，已保留")
          : t("Task stopped", "任务已停止"),
        "success",
      );
    } catch (error) {
      showToast(t("Could not stop the task: {message}", "停止任务失败：{message}", {
        message: errorText(error),
      }), "error");
    } finally {
      setStoppingId(null);
    }
  }

  return (
    <section className="ownership-section parallel-tasks" aria-labelledby="parallel-tasks-title">
      <div className="ownership-section-header">
        <span id="parallel-tasks-title">{t("Parallel tasks", "并行任务")}</span>
        <button
          className="workspace-navigation-add"
          type="button"
          aria-label={t("Start a parallel task in another folder", "在其他文件夹启动并行任务")}
          title={poolFull
            ? t("Task limit reached ({max}); stop one first", "已达任务上限（{max}），请先停止一个", {
                max: poolCap(taskRegistry),
              })
            : t("Start a parallel task in another folder", "在其他文件夹启动并行任务")}
          disabled={busy || poolFull}
          onClick={() => void handleCreate()}
        >
          <Icon name="plus" size={18} strokeWidth={1.5} />
        </button>
      </div>
      <div className="parallel-task-list" role="list">
        {rows.map((row) => (
          <div className={`parallel-task-row ${row.active ? "active" : ""}`} role="listitem" key={row.taskId}>
            <button
              className="parallel-task-main"
              type="button"
              aria-current={row.active ? "true" : undefined}
              title={row.cwd || row.label}
              disabled={busy || (!row.ready && !row.isPrimary)}
              onClick={() => void handleSwitch(row.taskId)}
            >
              <span
                className={`parallel-task-dot ${row.streaming ? "streaming" : row.ready ? "ready" : ""}`}
                aria-hidden="true"
              />
              <span className="parallel-task-label">{row.label}</span>
              {row.isPrimary && <span className="parallel-task-kind">{t("main", "主")}</span>}
              {row.branch && (
                <span className="parallel-task-branch" title={row.branch}>
                  {row.branch}
                </span>
              )}
              {switchingId === row.taskId && <span className="parallel-task-kind">…</span>}
              {row.unread > 0 && (
                <span
                  className="parallel-task-unread"
                  role="img"
                  aria-label={t("{count} unread updates", "{count} 条未读更新", { count: row.unread })}
                >
                  {row.unread}
                </span>
              )}
              {row.completed && row.unread === 0 && <Icon name="check" size={14} />}
            </button>
            {row.canStop && (
              <button
                className="parallel-task-stop"
                type="button"
                aria-label={t("Stop task {task}", "停止任务 {task}", { task: row.label })}
                title={t("Stop this task's backend", "停止此任务的后端")}
                disabled={busy}
                onClick={() => void handleStop(row.taskId)}
              >
                <Icon name="close" size={14} />
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
