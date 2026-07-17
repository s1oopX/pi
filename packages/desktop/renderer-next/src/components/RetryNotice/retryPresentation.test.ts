import { describe, expect, it } from "vitest";
import type { Message } from "../../ipc/types";
import { classifyRetryError, getRetryErrorDisplay } from "./retryPresentation";

function assistant(timestamp: number, options: { error?: string; text?: string } = {}): Extract<Message, { role: "assistant" }> {
  return {
    role: "assistant",
    content: options.text ? [{ type: "text", text: options.text }] : [],
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
    stopReason: options.error ? "error" : "stop",
    errorMessage: options.error,
    timestamp,
  };
}

function user(timestamp: number): Extract<Message, { role: "user" }> {
  return { role: "user", content: "prompt", timestamp };
}

describe("getRetryErrorDisplay", () => {
  it("hides an error-only response while its retry is active", () => {
    const display = getRetryErrorDisplay([user(1), assistant(2, { error: "503 unavailable" })], true);
    expect([...display.hiddenIndices]).toEqual([1]);
    expect([...display.suppressedErrorIndices]).toEqual([1]);
  });

  it("keeps partial response content while suppressing its retry error banner", () => {
    const display = getRetryErrorDisplay([
      user(1),
      assistant(2, { text: "partial answer", error: "connection reset" }),
    ], true);
    expect([...display.hiddenIndices]).toEqual([]);
    expect([...display.suppressedErrorIndices]).toEqual([1]);
  });

  it("hides superseded retry failures but leaves the final failure visible", () => {
    const messages = [
      user(1),
      assistant(2, { error: "503 first" }),
      assistant(3, { error: "503 final" }),
    ];
    const display = getRetryErrorDisplay(messages, false);
    expect([...display.hiddenIndices]).toEqual([1]);
    expect([...display.suppressedErrorIndices]).toEqual([1]);
  });

  it("does not treat an error from a previous user turn as superseded", () => {
    const messages = [
      user(1),
      assistant(2, { error: "first turn failed" }),
      user(3),
      assistant(4, { text: "second turn succeeded" }),
    ];
    const display = getRetryErrorDisplay(messages, false);
    expect([...display.hiddenIndices]).toEqual([]);
  });
});

describe("classifyRetryError", () => {
  it("reduces raw provider JSON to a server availability cause", () => {
    expect(classifyRetryError('503 {"error":{"message":"No available accounts"}}')).toEqual({
      cause: "server",
      statusCode: 503,
    });
  });

  it("recognizes rate limits and connection failures", () => {
    expect(classifyRetryError("429 rate limited").cause).toBe("rate-limit");
    expect(classifyRetryError("socket connection reset").cause).toBe("connection");
  });
});

