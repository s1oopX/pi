import { beforeEach, describe, expect, it } from "vitest";
import { useStore } from ".";

describe("tool execution state", () => {
  beforeEach(() => {
    useStore.setState({ toolExecutionsByCallId: {}, activeTool: null });
  });

  it("keeps queued calls distinct and never downgrades a started call", () => {
    const store = useStore.getState();
    store.queueToolExecutions([
      { callId: "read-1", toolName: "read" },
      { callId: "write-1", toolName: "write" },
    ]);

    expect(useStore.getState().toolExecutionsByCallId).toEqual({
      "read-1": { toolName: "read", phase: "queued" },
      "write-1": { toolName: "write", phase: "queued" },
    });
    expect(useStore.getState().activeTool).toBeNull();

    store.startToolExecution("read-1", "read");
    store.queueToolExecutions([{ callId: "read-1", toolName: "read" }]);
    expect(useStore.getState().toolExecutionsByCallId["read-1"]?.phase).toBe("running");
    expect(useStore.getState().activeTool).toBe("read");

    store.startToolExecution("write-1", "write");
    expect(useStore.getState().activeTool).toBe("write");
    store.finishToolExecution("write-1", "write", false);
    expect(useStore.getState().activeTool).toBe("read");
    store.finishToolExecution("read-1", "read", true);
    expect(useStore.getState().activeTool).toBeNull();
  });
});
