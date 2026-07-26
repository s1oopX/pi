/**
 * Pure task-registry logic for parallel tasks (M2 phase B1 — see
 * docs/parallel-tasks-m2-tdd.md). Two-tier model: the active task renders
 * through the existing AppState; every task additionally keeps this
 * lightweight summary fed by tagged backend events. All functions are
 * immutable state transitions so they unit-test without the store.
 */

export const PRIMARY_TASK_ID = "main";

export interface TaskSummary {
  taskId: string;
  cwd: string;
  isPrimary: boolean;
  ready: boolean;
  starting: boolean;
  streaming: boolean;
  unread: number;
  completed: boolean;
  /** Worktree tasks run on their own branch of the source repository. */
  branch?: string;
}

export interface TaskListSnapshot {
  taskId: string;
  cwd: string;
  isPrimary: boolean;
  ready: boolean;
  starting: boolean;
  branch?: string;
}

export interface TaskRegistryState {
  tasks: Record<string, TaskSummary>;
  activeTaskId: string;
}

export interface RouteResult {
  state: TaskRegistryState;
  /** Task the payload resolved to. */
  taskId: string;
  /** Feed the payload into the full single-conversation ingestion path. */
  forward: boolean;
  /** Surface a completion toast for a background task. */
  notify: boolean;
}

function emptySummary(taskId: string): TaskSummary {
  return {
    taskId,
    cwd: "",
    isPrimary: taskId === PRIMARY_TASK_ID,
    ready: false,
    starting: false,
    streaming: false,
    unread: 0,
    completed: false,
  };
}

export function createInitialTaskRegistryState(): TaskRegistryState {
  return {
    tasks: { [PRIMARY_TASK_ID]: { ...emptySummary(PRIMARY_TASK_ID), isPrimary: true } },
    activeTaskId: PRIMARY_TASK_ID,
  };
}

function withTask(
  state: TaskRegistryState,
  taskId: string,
  update: (summary: TaskSummary) => TaskSummary,
): TaskRegistryState {
  const existing = state.tasks[taskId] ?? emptySummary(taskId);
  return { ...state, tasks: { ...state.tasks, [taskId]: update(existing) } };
}

/** Untagged events come from a single-backend main process: the primary's. */
function resolveTaskId(state: TaskRegistryState, backendId: unknown): string {
  if (typeof backendId !== "string" || !backendId) return PRIMARY_TASK_ID;
  if (state.tasks[backendId]) return backendId;
  // Unknown but tagged: never let another backend's stream reach the active
  // conversation; register a self-healing summary instead.
  return backendId;
}

export interface RoutablePayload {
  type?: string;
  backendId?: unknown;
  willRetry?: boolean;
  [key: string]: unknown;
}

export function routeBackendEvent(state: TaskRegistryState, payload: RoutablePayload): RouteResult {
  const taskId = resolveTaskId(state, payload.backendId);
  const isActive = taskId === state.activeTaskId;
  let notify = false;

  let nextState = state;
  switch (payload.type) {
    case "agent_start":
      nextState = withTask(state, taskId, (summary) => ({ ...summary, streaming: true, completed: false }));
      break;
    case "agent_end": {
      const willRetry = Boolean(payload.willRetry);
      const completed = !willRetry && !isActive;
      notify = completed;
      nextState = withTask(state, taskId, (summary) => ({
        ...summary,
        streaming: willRetry,
        completed,
      }));
      break;
    }
    case "message_end":
      if (!isActive) {
        nextState = withTask(state, taskId, (summary) => ({ ...summary, unread: summary.unread + 1 }));
      }
      break;
    default:
      // Ensure unknown tagged tasks still materialize a summary row.
      if (!state.tasks[taskId]) {
        nextState = withTask(state, taskId, (summary) => summary);
      }
      break;
  }

  return { state: nextState, taskId, forward: isActive, notify };
}

/**
 * Readiness of whichever backend the UI is talking to: the primary's
 * connection state while it is active, else the pool task's summary.
 */
export function isActiveBackendReady(state: TaskRegistryState, primaryReady: boolean): boolean {
  if (state.activeTaskId === PRIMARY_TASK_ID) return primaryReady;
  return Boolean(state.tasks[state.activeTaskId]?.ready);
}

/** Short human label for a task: the folder name of its cwd, else the id. */
export function describeTask(summary: TaskSummary | undefined, taskId: string): string {
  const cwd = summary?.cwd ?? "";
  const base = cwd.split(/[\\/]/u).filter(Boolean).pop();
  return base || taskId;
}

export function switchTask(state: TaskRegistryState, taskId: string): TaskRegistryState {
  if (!state.tasks[taskId]) return state;
  const cleared = withTask(state, taskId, (summary) => ({ ...summary, unread: 0, completed: false }));
  return { ...cleared, activeTaskId: taskId };
}

export function mergeTaskList(state: TaskRegistryState, snapshots: TaskListSnapshot[]): TaskRegistryState {
  const tasks: Record<string, TaskSummary> = {};
  for (const snapshot of snapshots) {
    const existing = state.tasks[snapshot.taskId] ?? emptySummary(snapshot.taskId);
    tasks[snapshot.taskId] = {
      ...existing,
      taskId: snapshot.taskId,
      cwd: snapshot.cwd,
      isPrimary: snapshot.isPrimary,
      ready: snapshot.ready,
      starting: snapshot.starting,
      ...(snapshot.branch ? { branch: snapshot.branch } : {}),
    };
  }
  if (!tasks[PRIMARY_TASK_ID]) {
    tasks[PRIMARY_TASK_ID] = state.tasks[PRIMARY_TASK_ID] ?? emptySummary(PRIMARY_TASK_ID);
  }
  const activeTaskId = tasks[state.activeTaskId] ? state.activeTaskId : PRIMARY_TASK_ID;
  return { tasks, activeTaskId };
}

export function applyTaskStatus(
  state: TaskRegistryState,
  payload: { backendId?: unknown; ready?: unknown; starting?: unknown },
): TaskRegistryState {
  const taskId = resolveTaskId(state, payload.backendId);
  return withTask(state, taskId, (summary) => ({
    ...summary,
    ready: Boolean(payload.ready),
    starting: Boolean(payload.starting),
  }));
}
