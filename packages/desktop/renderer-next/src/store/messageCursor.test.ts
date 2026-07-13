import { describe, expect, it } from "vitest";
import type { Message } from "../ipc/types";
import { type MessageCursorState, reduceMessageEvent } from "./messageCursor";

function assistant(text: string, timestamp: number): Message {
  return {
    role: "assistant",
    content: text ? [{ type: "text", text }] : [],
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
    timestamp,
  };
}

function user(text: string, timestamp: number): Message {
  return { role: "user", content: text, timestamp };
}

const EMPTY: MessageCursorState = { messages: [], activeMessageIndex: null };

describe("reduceMessageEvent", () => {
  it("opens a message on message_start and tracks its index", () => {
    const state = reduceMessageEvent(EMPTY, assistant("", 1), "message_start");
    expect(state.messages).toHaveLength(1);
    expect(state.activeMessageIndex).toBe(0);
  });

  it("mutates the active message in place on message_update instead of appending", () => {
    let state = reduceMessageEvent(EMPTY, assistant("", 1), "message_start");
    state = reduceMessageEvent(state, assistant("hel", 1), "message_update");
    state = reduceMessageEvent(state, assistant("hello", 1), "message_update");

    expect(state.messages).toHaveLength(1);
    const msg = state.messages[0];
    expect(msg.role === "assistant" && msg.content[0].type === "text" && msg.content[0].text).toBe("hello");
  });

  it("closes the cursor on message_end", () => {
    let state = reduceMessageEvent(EMPTY, assistant("", 1), "message_start");
    state = reduceMessageEvent(state, assistant("done", 1), "message_end");
    expect(state.messages).toHaveLength(1);
    expect(state.activeMessageIndex).toBeNull();
  });

  it("does not collapse two assistant messages sharing a timestamp", () => {
    // Regression: role+timestamp matching would overwrite the first assistant
    // message when a second one streams within the same millisecond.
    let state = reduceMessageEvent(EMPTY, user("hi", 1), "message_start");
    state = reduceMessageEvent(state, user("hi", 1), "message_end");

    state = reduceMessageEvent(state, assistant("", 5), "message_start");
    state = reduceMessageEvent(state, assistant("first", 5), "message_end");

    state = reduceMessageEvent(state, assistant("", 5), "message_start");
    state = reduceMessageEvent(state, assistant("second", 5), "message_end");

    expect(state.messages).toHaveLength(3);
    const second = state.messages[2];
    const first = state.messages[1];
    expect(first.role === "assistant" && first.content[0].type === "text" && first.content[0].text).toBe("first");
    expect(second.role === "assistant" && second.content[0].type === "text" && second.content[0].text).toBe("second");
  });

  it("adopts an orphan message_update as a new message when no cursor is open", () => {
    const state = reduceMessageEvent(EMPTY, assistant("orphan", 1), "message_update");
    expect(state.messages).toHaveLength(1);
    expect(state.activeMessageIndex).toBe(0);
  });

  it("appends on message_end without an open cursor rather than dropping it", () => {
    const state = reduceMessageEvent(EMPTY, assistant("late", 1), "message_end");
    expect(state.messages).toHaveLength(1);
    expect(state.activeMessageIndex).toBeNull();
  });
});
