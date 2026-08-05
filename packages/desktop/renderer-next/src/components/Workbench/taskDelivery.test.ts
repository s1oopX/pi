import { describe, expect, it } from "vitest";
import type { Message, ToolCall } from "../../ipc/types";
import { summarizeTaskDelivery } from "./taskDelivery";

function assistant(...content: Array<ToolCall | { type: "text"; text: string }>): Message {
  return {
    role: "assistant",
    content,
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
    stopReason: "stop",
    timestamp: 1,
  };
}

describe("task delivery summary", () => {
  it("combines the final reply, plan progress, and produced artifacts", () => {
    const summary = summarizeTaskDelivery([
      assistant({
        type: "toolCall",
        id: "plan-1",
        name: "update_plan",
        arguments: {
          plan: [
            { step: "Inspect", status: "completed" },
            { step: "Implement", status: "in_progress" },
          ],
        },
      }),
      assistant(
        { type: "toolCall", id: "write-1", name: "write", arguments: { path: "reports/result.md" } },
        { type: "text", text: "Implemented the requested workflow." },
      ),
    ], false);

    expect(summary).toEqual({
      status: "ready",
      lastReply: "Implemented the requested workflow.",
      completedPlanSteps: 1,
      totalPlanSteps: 2,
      artifactCount: 1,
    });
  });

  it("distinguishes running and empty tasks", () => {
    expect(summarizeTaskDelivery([assistant({ type: "text", text: "Working" })], true).status).toBe("running");
    expect(summarizeTaskDelivery([], false)).toEqual({
      status: "empty",
      lastReply: null,
      completedPlanSteps: 0,
      totalPlanSteps: 0,
      artifactCount: 0,
    });
  });
});
