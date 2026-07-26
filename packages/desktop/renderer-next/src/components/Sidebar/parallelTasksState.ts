import type { TaskRegistryState, TaskSummary } from "../../store/taskRegistry";
import { describeTask, PRIMARY_TASK_ID } from "../../store/taskRegistry";

/** Mirrors DEFAULT_MAX_TASKS in src/task-registry.js. */
export const MAX_POOL_TASKS = 3;

export interface ParallelTaskRow {
  taskId: string;
  label: string;
  cwd: string;
  isPrimary: boolean;
  active: boolean;
  ready: boolean;
  starting: boolean;
  streaming: boolean;
  unread: number;
  completed: boolean;
  canStop: boolean;
}

function toRow(summary: TaskSummary, activeTaskId: string): ParallelTaskRow {
  return {
    taskId: summary.taskId,
    label: describeTask(summary, summary.taskId),
    cwd: summary.cwd,
    isPrimary: summary.isPrimary,
    active: summary.taskId === activeTaskId,
    ready: summary.ready,
    starting: summary.starting,
    streaming: summary.streaming,
    unread: summary.unread,
    completed: summary.completed,
    canStop: !summary.isPrimary,
  };
}

/** Primary first, then pool members in creation (task_N) order. */
export function buildParallelTaskRows(registry: TaskRegistryState): ParallelTaskRow[] {
  const pool = Object.values(registry.tasks)
    .filter((summary) => summary.taskId !== PRIMARY_TASK_ID)
    .sort((a, b) => {
      const left = Number(a.taskId.replace(/^task_/u, "")) || 0;
      const right = Number(b.taskId.replace(/^task_/u, "")) || 0;
      return left - right || a.taskId.localeCompare(b.taskId);
    });
  const primary = registry.tasks[PRIMARY_TASK_ID];
  const rows = primary ? [toRow(primary, registry.activeTaskId)] : [];
  rows.push(...pool.map((summary) => toRow(summary, registry.activeTaskId)));
  return rows;
}

export function poolTaskCount(registry: TaskRegistryState): number {
  return Object.keys(registry.tasks).filter((taskId) => taskId !== PRIMARY_TASK_ID).length;
}

export function isPoolFull(registry: TaskRegistryState): boolean {
  return poolTaskCount(registry) >= MAX_POOL_TASKS;
}
