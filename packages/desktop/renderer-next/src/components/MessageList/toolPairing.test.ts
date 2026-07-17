import { describe, expect, it } from "vitest";
import type { Message, ToolCall } from "../../ipc/types";
import type { ToolExecutionsByCallId } from "../../store";
import { buildFileChangeDisplayPlan, computeToolPairing } from "./toolPairing";

function call(name: string, id: string, args: Record<string, unknown>): ToolCall {
  return { type: "toolCall", id, name, arguments: args };
}

function assistant(content: ToolCall[]): Extract<Message, { role: "assistant" }> {
  return {
    role: "assistant",
    content,
    api: "anthropic-messages",
    provider: "anthropic",
    model: "claude",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "toolUse",
    timestamp: 1,
  };
}

function result(
  callId: string,
  options: { error?: boolean; text?: string; image?: boolean } = {},
): Extract<Message, { role: "toolResult" }> {
  return {
    role: "toolResult",
    toolCallId: callId,
    toolName: "edit",
    content: options.image
      ? [{ type: "image", data: "AAAA", mimeType: "image/png" }]
      : [{ type: "text", text: options.text ?? "ok" }],
    isError: options.error ?? false,
    timestamp: 2,
  };
}

describe("computeToolPairing", () => {
  it("maps tool results by call id and hides their standalone rows", () => {
    const toolResult = result("read-1");
    const pairing = computeToolPairing([assistant([call("read", "read-1", { path: "a.ts" })]), toolResult]);
    expect(pairing.resultsByCallId.get("read-1")).toBe(toolResult);
    expect([...pairing.hiddenIndices]).toEqual([1]);
  });
});

describe("buildFileChangeDisplayPlan", () => {
  const executions: ToolExecutionsByCallId = {
    write: { toolName: "write", phase: "running" },
    edit: { toolName: "edit", phase: "done" },
  };

  it("groups contiguous valid mutations in place and splits around other tools", () => {
    const message = assistant([
      call("write", "write", { path: "a.ts", content: "a" }),
      call("edit", "edit", { path: "b.ts", edits: [{}] }),
      call("read", "read", { path: "c.ts" }),
      call("write", "write-2", { path: "d.ts", content: "d" }),
    ]);
    const plan = buildFileChangeDisplayPlan(message, new Map(), executions, true);

    expect([...plan.groupsByStartIndex.keys()]).toEqual([0, 3]);
    expect(plan.groupsByStartIndex.get(0)?.changes.map((change) => change.callId)).toEqual(["write", "edit"]);
    expect([...plan.hiddenCallIds]).toEqual(["write", "edit", "write-2"]);
    expect(plan.groupsByStartIndex.get(0)?.changes[0].phase).toBe("running");
    expect(plan.groupsByStartIndex.get(1)).toBeUndefined();
  });

  it("keeps invalid paths and image results as ordinary tool cards", () => {
    const message = assistant([
      call("write", "invalid", { content: "a" }),
      call("edit", "image", { path: "image.png", edits: [{}] }),
    ]);
    const results = new Map([["image", result("image", { image: true })]]);
    const plan = buildFileChangeDisplayPlan(message, results, {}, false);

    expect(plan.groupsByStartIndex.size).toBe(0);
    expect(plan.hiddenCallIds.size).toBe(0);
  });

  it("preserves mutation error text inside the aggregate card", () => {
    const message = assistant([call("edit", "edit", { path: "a.ts", edits: [{}] })]);
    const results = new Map([["edit", result("edit", { error: true, text: "replacement did not match" })]]);
    const plan = buildFileChangeDisplayPlan(message, results, executions, false);
    const change = plan.groupsByStartIndex.get(0)?.changes[0];

    expect(change?.phase).toBe("error");
    expect(change?.resultText).toBe("replacement did not match");
  });
});
