import { describe, expect, it } from "vitest";
import type { Message } from "../ipc/types";
import { reconcileMessageSnapshot, type MessageCursorState, reduceMessageEvent } from "./messageCursor";

function assistant(text: string, timestamp: number, responseId?: string): Message {
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
    ...(responseId === undefined ? {} : { responseId }),
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

  it("restores history without losing an orphaned streaming cursor", () => {
    const history = [assistant("previous", 5)];
    const partial = assistant("current", 5);

    const state = reconcileMessageSnapshot({
      messages: [partial],
      activeMessageIndex: 0,
    }, history, true);

    expect(state.messages).toEqual([...history, partial]);
    expect(state.activeMessageIndex).toBe(1);

    const updated = reduceMessageEvent(state, assistant("current response", 5), "message_update");
    expect(updated.messages).toHaveLength(2);
    expect(updated.messages[0]).toEqual(history[0]);
  });

  it("reuses a finalized snapshot message when its response id is stable", () => {
    const partial = assistant("current", 5, "response-1");
    const finalized = assistant("current response", 5, "response-1");
    const state = reconcileMessageSnapshot({
      messages: [partial],
      activeMessageIndex: 0,
    }, [finalized], true);

    expect(state.messages).toEqual([finalized]);
    expect(state.activeMessageIndex).toBe(0);
  });

  it("does not use a same-timestamp earlier message as the stream cursor", () => {
    const earlier = assistant("current", 5);
    const partial = assistant("current response", 5);
    const state = reconcileMessageSnapshot({
      messages: [partial],
      activeMessageIndex: 0,
    }, [earlier], true);

    expect(state.messages).toEqual([earlier, partial]);
    expect(state.activeMessageIndex).toBe(1);
  });

  it("does not reuse an earlier assistant whose text extends the active prefix", () => {
    const earlier = assistant("same longer", 5);
    const partial = assistant("same", 5);
    const state = reconcileMessageSnapshot({ messages: [partial], activeMessageIndex: 0 }, [earlier], true);

    expect(state.messages).toEqual([earlier, partial]);
    expect(state.activeMessageIndex).toBe(1);

    const updated = reduceMessageEvent(state, assistant("same response", 5), "message_update");
    expect(updated.messages[0]).toEqual(earlier);
    expect(updated.messages[1]).toEqual(assistant("same response", 5));
  });

  it("does not match when only one side has a response id", () => {
    const partial = assistant("same", 5);
    const finalized = assistant("same longer", 5, "response-1");
    const state = reconcileMessageSnapshot({ messages: [partial], activeMessageIndex: 0 }, [finalized], true);

    expect(state.messages).toEqual([finalized, partial]);
    expect(state.activeMessageIndex).toBe(1);
  });

  it("does not match when the active id is absent from the snapshot", () => {
    const partial = assistant("same", 5, "response-1");
    const finalized = assistant("same longer", 5);
    const state = reconcileMessageSnapshot({ messages: [partial], activeMessageIndex: 0 }, [finalized], true);

    expect(state.messages).toEqual([finalized, partial]);
    expect(state.activeMessageIndex).toBe(1);
  });

  it("does not match different response ids", () => {
    const partial = assistant("same", 5, "response-1");
    const finalized = assistant("same longer", 5, "response-2");
    const state = reconcileMessageSnapshot({ messages: [partial], activeMessageIndex: 0 }, [finalized], true);

    expect(state.messages).toEqual([finalized, partial]);
    expect(state.activeMessageIndex).toBe(1);
  });

  it("matches an exact no-id snapshot only at the active slot", () => {
    const partial = assistant("same", 5);
    const state = reconcileMessageSnapshot({ messages: [partial], activeMessageIndex: 0 }, [partial], true);

    expect(state.messages).toEqual([partial]);
    expect(state.activeMessageIndex).toBe(0);
  });

  it("does not infer identity from thinking text growth without a response id", () => {
    const partial = { ...assistant("", 5), content: [{ type: "thinking", thinking: "reason" }] } as Message;
    const finalized = {
      ...assistant("", 5),
      content: [{ type: "thinking", thinking: "reasoning complete" }],
    } as Message;
    const state = reconcileMessageSnapshot({ messages: [partial], activeMessageIndex: 0 }, [finalized], true);

    expect(state.messages).toEqual([finalized, partial]);
    expect(state.activeMessageIndex).toBe(1);
  });

  it("does not infer identity from a tool-call id without a response id", () => {
    const partial = {
      ...assistant("", 5),
      content: [{ type: "toolCall", id: "call-1", name: "read", arguments: {} }],
    } as Message;
    const finalized = {
      ...assistant("", 5),
      content: [{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "README.md" } }],
    } as Message;
    const state = reconcileMessageSnapshot({ messages: [partial], activeMessageIndex: 0 }, [finalized], true);

    expect(state.messages).toEqual([finalized, partial]);
    expect(state.activeMessageIndex).toBe(1);
  });
});
