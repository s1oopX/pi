import { describe, expect, it } from "vitest";
import type { Message, ToolCall } from "../../ipc/types";
import { findLatestTaskGoal, findLatestTaskPlan } from "./planState";

function toolCall(id: string, args: Record<string, unknown>): ToolCall {
  return { type: "toolCall", id, name: "update_plan", arguments: args };
}

function assistant(...calls: ToolCall[]): Message {
  return {
    role: "assistant",
    content: calls,
    api: "openai-completions",
    provider: "faux",
    model: "faux-1",
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

describe("findLatestTaskPlan", () => {
  it("returns the latest valid update_plan call", () => {
    const result = findLatestTaskPlan([
      assistant(toolCall("first", { plan: [{ step: "Inspect", status: "in_progress" }] })),
      assistant(toolCall("second", {
        explanation: "Implementation started",
        plan: [
          { step: "Inspect", status: "completed" },
          { step: "Implement", status: "in_progress" },
        ],
      })),
    ]);

    expect(result).toEqual({
      explanation: "Implementation started",
      steps: [
        { step: "Inspect", status: "completed" },
        { step: "Implement", status: "in_progress" },
      ],
    });
  });

  it("keeps the previous plan while a streamed call is incomplete", () => {
    const result = findLatestTaskPlan([
      assistant(
        toolCall("valid", { plan: [{ step: "Inspect", status: "in_progress" }] }),
        toolCall("partial", { plan: [{ step: "Implement" }] }),
      ),
    ]);

    expect(result?.steps).toEqual([{ step: "Inspect", status: "in_progress" }]);
  });

  it("returns null when no valid plan exists", () => {
    expect(findLatestTaskPlan([assistant(toolCall("invalid", { plan: "later" }))])).toBeNull();
  });
});

describe("findLatestTaskGoal", () => {
  it("returns the latest successful goal state", () => {
    const result = findLatestTaskGoal([
      {
        role: "toolResult",
        toolCallId: "goal-1",
        toolName: "create_goal",
        content: [],
        isError: false,
        timestamp: 1,
        details: { objective: "Ship desktop parity", status: "active", tokensUsed: 120 },
      },
      {
        role: "toolResult",
        toolCallId: "goal-2",
        toolName: "update_goal",
        content: [],
        isError: false,
        timestamp: 2,
        details: { objective: "Ship desktop parity", status: "blocked", tokensUsed: 240 },
      },
    ]);

    expect(result).toEqual({ objective: "Ship desktop parity", status: "blocked", tokensUsed: 240 });
  });

  it("ignores failed goal results", () => {
    expect(findLatestTaskGoal([
      {
        role: "toolResult",
        toolCallId: "goal-1",
        toolName: "create_goal",
        content: [],
        isError: true,
        timestamp: 1,
        details: { objective: "Not created", status: "active" },
      },
    ])).toBeNull();
  });
});
