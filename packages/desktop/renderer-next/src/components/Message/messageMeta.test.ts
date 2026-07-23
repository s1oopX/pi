import { describe, expect, it } from "vitest";
import type { Message } from "../../ipc/types";
import { formatMessageMeta } from "./messageMeta";

type AssistantMessage = Extract<Message, { role: "assistant" }>;

function assistantMessage(overrides: {
  input?: number;
  output?: number;
  totalTokens?: number;
  costTotal?: number;
  model?: string;
  responseModel?: string;
  timestamp?: number;
} = {}): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: "anthropic-messages",
    provider: "anthropic",
    model: overrides.model ?? "claude-opus",
    responseModel: overrides.responseModel,
    usage: {
      input: overrides.input ?? 0,
      output: overrides.output ?? 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: overrides.totalTokens ?? 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: overrides.costTotal ?? 0 },
    },
    stopReason: "stop",
    timestamp: overrides.timestamp ?? 0,
  };
}

describe("formatMessageMeta", () => {
  it("returns an empty line for non-assistant messages", () => {
    expect(formatMessageMeta({ role: "user", content: "hi", timestamp: 0 }, "en").line).toBe("");
  });

  it("formats token count from totalTokens", () => {
    const meta = formatMessageMeta(assistantMessage({ totalTokens: 820 }), "en");
    expect(meta.tokens).toBe("820 tokens");
  });

  it("abbreviates thousands with one decimal below 10k", () => {
    const meta = formatMessageMeta(assistantMessage({ totalTokens: 1234 }), "en");
    expect(meta.tokens).toBe("1.2k tokens");
  });

  it("abbreviates whole thousands at or above 10k", () => {
    const meta = formatMessageMeta(assistantMessage({ totalTokens: 24000 }), "en");
    expect(meta.tokens).toBe("24k tokens");
  });

  it("falls back to input + output when totalTokens is zero", () => {
    const meta = formatMessageMeta(assistantMessage({ input: 300, output: 200 }), "en");
    expect(meta.tokens).toBe("500 tokens");
  });

  it("omits tokens entirely when there is no usage", () => {
    const meta = formatMessageMeta(assistantMessage(), "en");
    expect(meta.tokens).toBeUndefined();
  });

  it("formats sub-cent cost with four decimals", () => {
    const meta = formatMessageMeta(assistantMessage({ costTotal: 0.0012 }), "en");
    expect(meta.cost).toBe("$0.0012");
  });

  it("formats mid-range cost with three decimals", () => {
    const meta = formatMessageMeta(assistantMessage({ costTotal: 0.123 }), "en");
    expect(meta.cost).toBe("$0.123");
  });

  it("formats dollar-plus cost with two decimals", () => {
    const meta = formatMessageMeta(assistantMessage({ costTotal: 1.5 }), "en");
    expect(meta.cost).toBe("$1.50");
  });

  it("omits cost when zero", () => {
    const meta = formatMessageMeta(assistantMessage({ costTotal: 0 }), "en");
    expect(meta.cost).toBeUndefined();
  });

  it("prefers responseModel over the request model", () => {
    const meta = formatMessageMeta(
      assistantMessage({ model: "router", responseModel: "claude-opus-4" }),
      "en",
    );
    expect(meta.model).toBe("claude-opus-4");
  });

  it("falls back to the request model when responseModel is absent", () => {
    const meta = formatMessageMeta(assistantMessage({ model: "claude-sonnet" }), "en");
    expect(meta.model).toBe("claude-sonnet");
  });

  it("formats completion time as zero-padded HH:MM", () => {
    const at = new Date(2026, 0, 2, 9, 5).getTime();
    const meta = formatMessageMeta(assistantMessage({ timestamp: at }), "en");
    expect(meta.time).toBe("09:05");
  });

  it("omits time for a zero timestamp", () => {
    const meta = formatMessageMeta(assistantMessage({ timestamp: 0 }), "en");
    expect(meta.time).toBeUndefined();
  });

  it("joins available parts with a middot", () => {
    const at = new Date(2026, 0, 2, 14, 32).getTime();
    const meta = formatMessageMeta(
      assistantMessage({ totalTokens: 1200, costTotal: 0.05, model: "claude-opus", timestamp: at }),
      "en",
    );
    expect(meta.line).toBe("1.2k tokens · $0.050 · claude-opus · 14:32");
  });

  it("skips missing parts when joining the line", () => {
    const meta = formatMessageMeta(assistantMessage({ totalTokens: 500, model: "claude" }), "en");
    expect(meta.line).toBe("500 tokens · claude");
  });
});
