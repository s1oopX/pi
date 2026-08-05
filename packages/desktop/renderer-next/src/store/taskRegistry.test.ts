import { describe, expect, it } from "vitest";
import {
  applyTaskStatus,
  createInitialTaskRegistryState,
  mergeTaskList,
  routeBackendEvent,
  switchTask,
} from "./taskRegistry";

function stateWithBackgroundTask() {
  let state = createInitialTaskRegistryState();
  state = mergeTaskList(state, [
    { taskId: "main", cwd: "C:\\primary", isPrimary: true, ready: true, starting: false },
    { taskId: "task_1", cwd: "C:\\pool\\a", isPrimary: false, ready: true, starting: false },
  ]);
  return state;
}

describe("routeBackendEvent", () => {
  it("updates the registry for a background task without forwarding", () => {
    let state = stateWithBackgroundTask();

    const started = routeBackendEvent(state, { type: "agent_start", backendId: "task_1" });
    expect(started.forward).toBe(false);
    expect(started.notify).toBe(false);
    expect(started.state.tasks.task_1.streaming).toBe(true);

    state = started.state;
    const messaged = routeBackendEvent(state, {
      type: "message_end",
      backendId: "task_1",
      message: { role: "assistant", content: [] },
    });
    expect(messaged.forward).toBe(false);
    expect(messaged.state.tasks.task_1.unread).toBe(1);

    state = messaged.state;
    const ended = routeBackendEvent(state, { type: "agent_end", backendId: "task_1", willRetry: false });
    expect(ended.forward).toBe(false);
    expect(ended.notify).toBe(true);
    expect(ended.state.tasks.task_1.streaming).toBe(false);
    expect(ended.state.tasks.task_1.completed).toBe(true);
  });

  it("keeps a retrying background agent_end streaming without notifying", () => {
    const state = stateWithBackgroundTask();
    const ended = routeBackendEvent(state, { type: "agent_end", backendId: "task_1", willRetry: true });
    expect(ended.notify).toBe(false);
    expect(ended.state.tasks.task_1.streaming).toBe(true);
    expect(ended.state.tasks.task_1.completed).toBe(false);
  });

  it("forwards active-task events and never counts them unread", () => {
    const state = stateWithBackgroundTask();
    const result = routeBackendEvent(state, {
      type: "message_end",
      backendId: "main",
      message: { role: "assistant", content: [] },
    });
    expect(result.forward).toBe(true);
    expect(result.state.tasks.main.unread).toBe(0);
  });

  it("treats untagged events as the primary's (single-backend back-compat)", () => {
    const state = stateWithBackgroundTask();
    const result = routeBackendEvent(state, { type: "agent_start" });
    expect(result.forward).toBe(true);
    expect(result.state.tasks.main.streaming).toBe(true);
  });

  it("self-heals an unknown tagged task by registering a summary instead of polluting the active view", () => {
    const state = createInitialTaskRegistryState();
    const result = routeBackendEvent(state, { type: "agent_start", backendId: "task_9" });
    expect(result.forward).toBe(false);
    expect(result.state.tasks.task_9?.streaming).toBe(true);
    expect(result.state.tasks.task_9?.isPrimary).toBe(false);
  });
});

describe("switchTask", () => {
  it("activates the task and clears its unread and completed flags", () => {
    let state = stateWithBackgroundTask();
    state = routeBackendEvent(state, {
      type: "message_end",
      backendId: "task_1",
      message: { role: "assistant", content: [] },
    }).state;
    state = routeBackendEvent(state, { type: "agent_end", backendId: "task_1", willRetry: false }).state;

    const switched = switchTask(state, "task_1");
    expect(switched.activeTaskId).toBe("task_1");
    expect(switched.tasks.task_1.unread).toBe(0);
    expect(switched.tasks.task_1.completed).toBe(false);
  });

  it("ignores unknown targets", () => {
    const state = stateWithBackgroundTask();
    expect(switchTask(state, "task_42")).toBe(state);
  });
});

describe("mergeTaskList", () => {
  it("hydrates persisted inbox state from the main-process snapshot", () => {
    const state = createInitialTaskRegistryState();
    const merged = mergeTaskList(state, [
      { taskId: "main", cwd: "C:\\primary", isPrimary: true, ready: true, starting: false },
      {
        taskId: "task_1",
        cwd: "C:\\pool\\a",
        isPrimary: false,
        ready: true,
        starting: false,
        streaming: false,
        unread: 2,
        completed: true,
      },
    ]);
    expect(merged.tasks.task_1.unread).toBe(2);
    expect(merged.tasks.task_1.completed).toBe(true);
  });

  it("preserves live event state for existing tasks and drops vanished ones", () => {
    let state = stateWithBackgroundTask();
    state = routeBackendEvent(state, { type: "agent_start", backendId: "task_1" }).state;
    state = routeBackendEvent(state, {
      type: "message_end",
      backendId: "task_1",
      message: { role: "assistant", content: [] },
    }).state;

    const merged = mergeTaskList(state, [
      { taskId: "main", cwd: "C:\\primary", isPrimary: true, ready: true, starting: false },
      { taskId: "task_1", cwd: "C:\\pool\\a", isPrimary: false, ready: true, starting: false },
      { taskId: "task_2", cwd: "C:\\pool\\b", isPrimary: false, ready: false, starting: true },
    ]);
    expect(merged.tasks.task_1.streaming).toBe(true);
    expect(merged.tasks.task_1.unread).toBe(1);
    expect(merged.tasks.task_2.starting).toBe(true);

    const dropped = mergeTaskList(merged, [
      { taskId: "main", cwd: "C:\\primary", isPrimary: true, ready: true, starting: false },
    ]);
    expect(dropped.tasks.task_1).toBeUndefined();
    expect(dropped.tasks.main).toBeDefined();
  });

  it("falls back to the primary when the active task vanishes", () => {
    let state = stateWithBackgroundTask();
    state = switchTask(state, "task_1");
    const dropped = mergeTaskList(state, [
      { taskId: "main", cwd: "C:\\primary", isPrimary: true, ready: true, starting: false },
    ]);
    expect(dropped.activeTaskId).toBe("main");
  });
});

describe("applyTaskStatus", () => {
  it("merges tagged status payloads into the matching summary", () => {
    const state = stateWithBackgroundTask();
    const updated = applyTaskStatus(state, { backendId: "task_1", ready: false, starting: true });
    expect(updated.tasks.task_1.ready).toBe(false);
    expect(updated.tasks.task_1.starting).toBe(true);
    expect(updated.tasks.main.ready).toBe(true);
  });

  it("routes untagged status to the primary", () => {
    const state = stateWithBackgroundTask();
    const updated = applyTaskStatus(state, { ready: false, starting: true });
    expect(updated.tasks.main.ready).toBe(false);
  });
});
