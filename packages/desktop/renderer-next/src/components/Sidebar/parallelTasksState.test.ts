import { describe, expect, it } from "vitest";
import { createInitialTaskRegistryState, mergeTaskList, routeBackendEvent, switchTask } from "../../store/taskRegistry";
import { buildParallelTaskRows, isPoolFull, poolTaskCount } from "./parallelTasksState";

function registryWithPool() {
  let state = createInitialTaskRegistryState();
  state = mergeTaskList(state, [
    { taskId: "main", cwd: "C:\\repos\\primary", isPrimary: true, ready: true, starting: false },
    { taskId: "task_2", cwd: "C:\\repos\\beta", isPrimary: false, ready: true, starting: false },
    { taskId: "task_1", cwd: "C:\\repos\\alpha", isPrimary: false, ready: false, starting: true },
  ]);
  return state;
}

describe("buildParallelTaskRows", () => {
  it("orders primary first then pool members by creation order with folder labels", () => {
    const rows = buildParallelTaskRows(registryWithPool());
    expect(rows.map((row) => row.taskId)).toEqual(["main", "task_1", "task_2"]);
    expect(rows.map((row) => row.label)).toEqual(["primary", "alpha", "beta"]);
    expect(rows[0].canStop).toBe(false);
    expect(rows[1].canStop).toBe(true);
  });

  it("carries the worktree branch through to the row", () => {
    let state = createInitialTaskRegistryState();
    state = mergeTaskList(state, [
      { taskId: "main", cwd: "C:\\repos\\primary", isPrimary: true, ready: true, starting: false },
      { taskId: "task_1", cwd: "C:\\wt\\primary-1", isPrimary: false, ready: true, starting: false, branch: "task/primary-1" },
    ]);
    const rows = buildParallelTaskRows(state);
    expect(rows.find((row) => row.taskId === "task_1")?.branch).toBe("task/primary-1");
    expect(rows.find((row) => row.taskId === "main")?.branch).toBeUndefined();
  });

  it("marks the active row and carries live event state", () => {
    let state = registryWithPool();
    state = routeBackendEvent(state, { type: "agent_start", backendId: "task_2" }).state;
    state = routeBackendEvent(state, {
      type: "message_end",
      backendId: "task_2",
      message: { role: "assistant", content: [] },
    }).state;
    state = switchTask(state, "task_1");

    const rows = buildParallelTaskRows(state);
    const active = rows.find((row) => row.active);
    const beta = rows.find((row) => row.taskId === "task_2");
    expect(active?.taskId).toBe("task_1");
    expect(beta?.streaming).toBe(true);
    expect(beta?.unread).toBe(1);
  });
});

describe("pool capacity", () => {
  it("counts only pool members and reports fullness at three", () => {
    let state = registryWithPool();
    expect(poolTaskCount(state)).toBe(2);
    expect(isPoolFull(state)).toBe(false);
    state = mergeTaskList(state, [
      { taskId: "main", cwd: "C:\\repos\\primary", isPrimary: true, ready: true, starting: false },
      { taskId: "task_1", cwd: "C:\\repos\\alpha", isPrimary: false, ready: true, starting: false },
      { taskId: "task_2", cwd: "C:\\repos\\beta", isPrimary: false, ready: true, starting: false },
      { taskId: "task_3", cwd: "C:\\repos\\gamma", isPrimary: false, ready: true, starting: false },
    ]);
    expect(isPoolFull(state)).toBe(true);
  });
});
