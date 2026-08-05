import { useState } from "react";
import { useI18n } from "../../i18n";
import * as api from "../../ipc/api";
import { useStore } from "../../store";
import { describeTask, PRIMARY_TASK_ID } from "../../store/taskRegistry";
import { Icon } from "../Icon";
import { showToast } from "../Toast";
import { requestTaskReview } from "../Workbench/taskReviewNavigation";
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
  const primaryBackendStatus = useStore((s) => s.backendStatus);
  const switchActiveTask = useStore((s) => s.switchActiveTask);
  const refreshTasks = useStore((s) => s.refreshTasks);
  const switchingWorkspace = useStore((s) => s.workspaceLoading);
  const [creating, setCreating] = useState(false);
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [recoveringId, setRecoveringId] = useState<string | null>(null);
  const [forgettingId, setForgettingId] = useState<string | null>(null);

  const rows = buildParallelTaskRows(taskRegistry);
  const attentionCount = taskRegistry.unavailableTasks.length
    + rows.filter((row) => row.streaming || row.unread > 0 || row.completed).length;
  const poolFull = isPoolFull(taskRegistry);
  const busy = creating || Boolean(stoppingId) || Boolean(switchingId) || Boolean(recoveringId) || Boolean(forgettingId) || switchingWorkspace;
  const primaryCwd = taskRegistry.tasks[PRIMARY_TASK_ID]?.cwd ?? "";
  const remotePrimary = primaryCwd.startsWith("ssh://");
  const createLabel = remotePrimary
    ? t("Start an isolated worktree on the remote host", "在远程主机上启动隔离工作树")
    : t("Start a parallel task in another folder", "在其他文件夹启动并行任务");

  async function handleCreate() {
    if (busy || poolFull) return;
    setCreating(true);
    try {
      let cwd = primaryCwd;
      if (!remotePrimary) {
        const picked = await api.pickTaskFolder();
        if (picked.canceled || !picked.cwd) return;
        cwd = picked.cwd;
      }
      const created = await api.createTask(cwd);
      await refreshTasks();
      await switchActiveTask(created.taskId);
      showToast(
        created.branch
          ? t("Parallel task started on {branch}", "已在分支 {branch} 上启动并行任务", { branch: created.branch })
          : t("Parallel task started in {cwd}", "已在 {cwd} 启动并行任务", { cwd: created.cwd }),
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

  async function handleSwitch(taskId: string, openReview: boolean) {
    if (busy || taskId === taskRegistry.activeTaskId) return;
    setSwitchingId(taskId);
    try {
      await switchActiveTask(taskId);
      if (openReview) requestTaskReview();
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

  async function handleRetry(taskId: string, label: string) {
    if (busy) return;
    setRecoveringId(taskId);
    try {
      await api.retryTask(taskId);
      await refreshTasks();
      showToast(t("Restoring task {task}", "正在恢复任务 {task}", { task: label }), "success");
    } catch (error) {
      showToast(t("Could not restore task: {message}", "无法恢复任务：{message}", {
        message: errorText(error),
      }), "error");
    } finally {
      setRecoveringId(null);
    }
  }

  async function handleForget(taskId: string, label: string) {
    if (busy || !window.confirm(t(
      "Remove saved task {task}? Workspace files and session history will stay on disk.",
      "移除已保存的任务 {task}？工作区文件和会话历史仍会保留在磁盘上。",
      { task: label },
    ))) return;
    setForgettingId(taskId);
    try {
      await api.forgetSavedTask(taskId);
      await refreshTasks();
      showToast(t("Saved task removed", "已移除保存的任务"), "success");
    } catch (error) {
      showToast(t("Could not remove saved task: {message}", "无法移除保存的任务：{message}", {
        message: errorText(error),
      }), "error");
    } finally {
      setForgettingId(null);
    }
  }

  return (
    <section className="ownership-section parallel-tasks" aria-labelledby="parallel-tasks-title">
      <div className="ownership-section-header">
        <span id="parallel-tasks-title">{t("Activity", "活动")}</span>
        {attentionCount > 0 && <span className="activity-count">{attentionCount}</span>}
        <button
          className="workspace-navigation-add"
          type="button"
          aria-label={createLabel}
          title={poolFull
            ? t("Task limit reached ({max}); stop one first", "已达任务上限（{max}），请先停止一个", {
                max: poolCap(taskRegistry),
              })
            : createLabel}
          disabled={busy || poolFull}
          onClick={() => void handleCreate()}
        >
          <Icon name="plus" size={18} strokeWidth={1.5} />
        </button>
      </div>
      {taskRegistry.error && (
        <div className="parallel-tasks-error" role="alert" title={taskRegistry.error}>
          {taskRegistry.error}
        </div>
      )}
      {taskRegistry.unavailableTasks.length > 0 && (
        <div
          className="parallel-task-recovery-list"
          role="list"
          aria-label={t("Saved tasks needing attention", "需要处理的已保存任务")}
          aria-live="polite"
        >
          {taskRegistry.unavailableTasks.map((task) => {
            const label = describeTask(task, task.taskId);
            return (
              <div
                className="parallel-task-recovery-row"
                role="listitem"
                data-unavailable-task-id={task.taskId}
                key={task.taskId}
                title={`${task.cwd}\n${task.error}`}
              >
                <Icon name="alert-triangle" size={14} />
                <div className="parallel-task-recovery-copy">
                  <span className="parallel-task-recovery-label">{label}</span>
                  <span className="parallel-task-recovery-error">{task.error}</span>
                </div>
                <button
                  className="parallel-task-recovery-action parallel-task-retry"
                  type="button"
                  aria-label={t("Retry task {task}", "重试任务 {task}", { task: label })}
                  title={t("Retry saved task", "重试保存的任务")}
                  disabled={busy}
                  onClick={() => void handleRetry(task.taskId, label)}
                >
                  <Icon name="rotate-cw" size={14} />
                </button>
                <button
                  className="parallel-task-recovery-action parallel-task-forget"
                  type="button"
                  aria-label={t("Remove saved task {task}", "移除保存的任务 {task}", { task: label })}
                  title={t("Remove saved task", "移除保存的任务")}
                  disabled={busy}
                  onClick={() => void handleForget(task.taskId, label)}
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
            );
          })}
        </div>
      )}
      <div className="parallel-task-list" role="list">
        {rows.map((row) => {
          const ready = row.isPrimary ? primaryBackendStatus.ready : row.ready;
          const starting = row.isPrimary
            ? primaryBackendStatus.starting || primaryBackendStatus.restarting
            : row.starting;
          const status = row.streaming
            ? t("Running", "运行中")
            : row.completed || row.unread > 0
                ? t("Ready", "已就绪")
                : ready
                  ? t("Idle", "空闲")
                  : starting
                    ? t("Starting", "启动中")
                    : t("Offline", "离线");
          return (
            <div className={`parallel-task-row ${row.active ? "active" : ""}`} role="listitem" key={row.taskId}>
              <button
                className="parallel-task-main"
                type="button"
                aria-current={row.active ? "true" : undefined}
                title={row.cwd || row.label}
                disabled={busy || (!ready && !row.isPrimary)}
                onClick={() => void handleSwitch(row.taskId, row.completed)}
              >
                <span
                  className={`parallel-task-dot ${row.streaming ? "streaming" : ready ? "ready" : ""}`}
                  aria-hidden="true"
                />
                <span className="parallel-task-label">{row.label}</span>
                {row.isPrimary && <span className="parallel-task-kind">{t("main", "主")}</span>}
                {row.branch && (
                  <span className="parallel-task-branch" title={row.branch}>
                    {row.branch}
                  </span>
                )}
                <span
                  className={`parallel-task-status ${row.streaming ? "running" : row.completed || row.unread > 0 ? "ready" : ""}`}
                >
                  {status}
                </span>
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
          );
        })}
      </div>
    </section>
  );
}
