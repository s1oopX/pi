import { describe, expect, it } from "vitest";
import type { Message } from "../../ipc/types";
import { shouldAutoFollowStream, shouldShowListStreamingDots } from "./streamingPresentation";

function assistant(): Message {
  return {
    role: "assistant",
    content: [{ type: "text", text: "hi" }],
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
    stopReason: "stop",
    timestamp: 1,
  };
}

function user(): Message {
  return { role: "user", content: "go", timestamp: 1 };
}

describe("shouldShowListStreamingDots", () => {
  it("hides list dots when the streaming tail is an assistant turn", () => {
    expect(shouldShowListStreamingDots({
      isStreaming: true,
      streamingIndex: 1,
      messages: [user(), assistant()],
    })).toBe(false);
  });

  it("shows list dots when streaming without an assistant tail", () => {
    expect(shouldShowListStreamingDots({
      isStreaming: true,
      streamingIndex: -1,
      messages: [user()],
    })).toBe(true);
    expect(shouldShowListStreamingDots({
      isStreaming: true,
      streamingIndex: 0,
      messages: [user()],
    })).toBe(true);
  });

  it("never shows when not streaming", () => {
    expect(shouldShowListStreamingDots({
      isStreaming: false,
      streamingIndex: 1,
      messages: [user(), assistant()],
    })).toBe(false);
  });
});

describe("shouldAutoFollowStream", () => {
  it("follows only while the user is near the bottom", () => {
    expect(shouldAutoFollowStream({ isStreaming: true, userNearBottom: true })).toBe(true);
    expect(shouldAutoFollowStream({ isStreaming: true, userNearBottom: false })).toBe(false);
    expect(shouldAutoFollowStream({ isStreaming: false, userNearBottom: true })).toBe(true);
  });
});
