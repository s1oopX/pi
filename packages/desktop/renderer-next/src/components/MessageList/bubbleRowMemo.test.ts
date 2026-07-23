import { describe, expect, it } from "vitest";
import type { Message, ToolCall } from "../../ipc/types";
import type { ToolExecutionsByCallId } from "../../store";
import { areBubbleRowPropsEqual, type BubbleRowProps } from "./bubbleRowMemo";

type ToolResult = Extract<Message, { role: "toolResult" }>;

function toolCall(id: string, name = "bash"): ToolCall {
  return { type: "toolCall", id, name, arguments: { command: "ls" } };
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

function result(callId: string, text = "ok"): ToolResult {
  return {
    role: "toolResult",
    toolCallId: callId,
    toolName: "bash",
    content: [{ type: "text", text }],
    isError: false,
    timestamp: 1,
  };
}

function userMessage(text: string): Extract<Message, { role: "user" }> {
  return { role: "user", content: [{ type: "text", text }], timestamp: 1 };
}

function props(overrides: Partial<BubbleRowProps>): BubbleRowProps {
  return {
    message: userMessage("hi"),
    suppressError: false,
    resultsByCallId: new Map(),
    toolExecutionsByCallId: {},
    ...overrides,
  };
}

describe("areBubbleRowPropsEqual", () => {
  it("treats identical references as equal", () => {
    const message = userMessage("hi");
    const resultsByCallId = new Map<string, ToolResult>();
    const toolExecutionsByCallId: ToolExecutionsByCallId = {};
    const a = props({ message, resultsByCallId, toolExecutionsByCallId });
    const b = props({ message, resultsByCallId, toolExecutionsByCallId });
    expect(areBubbleRowPropsEqual(a, b)).toBe(true);
  });

  it("re-renders when the message object changes", () => {
    expect(
      areBubbleRowPropsEqual(props({ message: userMessage("a") }), props({ message: userMessage("b") })),
    ).toBe(false);
  });

  it("re-renders when suppressError flips", () => {
    const message = userMessage("hi");
    expect(
      areBubbleRowPropsEqual(
        props({ message, suppressError: false }),
        props({ message, suppressError: true }),
      ),
    ).toBe(false);
  });

  it("ignores a new pairing-map reference when no relevant entry changed", () => {
    const message = assistant([toolCall("c1")]);
    const sharedResult = result("c1");
    const sharedExecution = { toolName: "bash", phase: "done" as const };
    const a = props({
      message,
      resultsByCallId: new Map([["c1", sharedResult]]),
      toolExecutionsByCallId: { c1: sharedExecution },
    });
    const b = props({
      message,
      // Fresh Map/object containers (as rebuilt on every streaming token) but
      // the same entry references.
      resultsByCallId: new Map([["c1", sharedResult]]),
      toolExecutionsByCallId: { c1: sharedExecution },
    });
    expect(areBubbleRowPropsEqual(a, b)).toBe(true);
  });

  it("re-renders when a referenced tool result changes", () => {
    const message = assistant([toolCall("c1")]);
    const a = props({ message, resultsByCallId: new Map([["c1", result("c1", "old")]]) });
    const b = props({ message, resultsByCallId: new Map([["c1", result("c1", "new")]]) });
    expect(areBubbleRowPropsEqual(a, b)).toBe(false);
  });

  it("re-renders when a referenced execution entry changes", () => {
    const message = assistant([toolCall("c1")]);
    const a = props({ message, toolExecutionsByCallId: { c1: { toolName: "bash", phase: "running" } } });
    const b = props({ message, toolExecutionsByCallId: { c1: { toolName: "bash", phase: "done" } } });
    expect(areBubbleRowPropsEqual(a, b)).toBe(false);
  });

  it("ignores changes to unrelated tool calls", () => {
    const message = assistant([toolCall("c1")]);
    // c1's entry keeps the same reference; only an unrelated call ("other")
    // changes. The row does not read "other", so it must not re-render.
    const sharedC1 = { toolName: "bash", phase: "done" as const };
    const a = props({
      message,
      toolExecutionsByCallId: { c1: sharedC1, other: { toolName: "read", phase: "running" } },
    });
    const b = props({
      message,
      toolExecutionsByCallId: { c1: sharedC1, other: { toolName: "read", phase: "done" } },
    });
    expect(areBubbleRowPropsEqual(a, b)).toBe(true);
  });

  it("does not read pairing maps for non-assistant messages", () => {
    const message = userMessage("hi");
    const a = props({ message, resultsByCallId: new Map([["c1", result("c1")]]) });
    const b = props({ message, resultsByCallId: new Map() });
    expect(areBubbleRowPropsEqual(a, b)).toBe(true);
  });
});
