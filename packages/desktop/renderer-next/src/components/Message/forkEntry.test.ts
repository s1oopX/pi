import { describe, expect, it } from "vitest";
import type { Message } from "../../ipc/types";
import { resolveForkEntryId, type ForkMessageRef } from "./forkEntry";

function user(text: string): Extract<Message, { role: "user" }> {
  return { role: "user", content: text, timestamp: 0 };
}

function userBlocks(...texts: string[]): Extract<Message, { role: "user" }> {
  return {
    role: "user",
    content: texts.map((text) => ({ type: "text" as const, text })),
    timestamp: 0,
  };
}

function assistant(): Extract<Message, { role: "assistant" }> {
  return {
    role: "assistant",
    content: [],
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
    timestamp: 0,
  };
}

const fork = (entryId: string, text: string): ForkMessageRef => ({ entryId, text });

describe("resolveForkEntryId", () => {
  it("pairs the only user message with the only fork entry", () => {
    const messages = [user("hello"), assistant()];
    expect(resolveForkEntryId(messages, [fork("e1", "hello")], 0)).toBe("e1");
  });

  it("pairs the Nth forkable user message with the Nth fork entry", () => {
    const messages = [user("first"), assistant(), user("second"), assistant(), user("third")];
    const forks = [fork("e1", "first"), fork("e2", "second"), fork("e3", "third")];
    expect(resolveForkEntryId(messages, forks, 0)).toBe("e1");
    expect(resolveForkEntryId(messages, forks, 2)).toBe("e2");
    expect(resolveForkEntryId(messages, forks, 4)).toBe("e3");
  });

  it("skips empty-text user messages when counting ordinals (mirrors backend filter)", () => {
    // The middle user message has no text (e.g. image-only in an external
    // session), so it is absent from the fork list; the third message pairs
    // with the second fork entry.
    const messages = [user("first"), userBlocks(""), user("third")];
    const forks = [fork("e1", "first"), fork("e3", "third")];
    expect(resolveForkEntryId(messages, forks, 0)).toBe("e1");
    expect(resolveForkEntryId(messages, forks, 2)).toBe("e3");
  });

  it("matches text sourced from multi-block content across differing joins", () => {
    // Renderer joins blocks with "\n\n"; the fork list joins with "". Normalized
    // comparison collapses whitespace so both resolve to the same entry.
    const messages = [userBlocks("line one", "line two")];
    expect(resolveForkEntryId(messages, [fork("e1", "line oneline two")], 0)).toBe("e1");
  });

  it("returns null when the target is not a user message", () => {
    const messages = [user("hi"), assistant()];
    expect(resolveForkEntryId(messages, [fork("e1", "hi")], 1)).toBeNull();
  });

  it("returns null when the target has no text", () => {
    const messages = [userBlocks("")];
    expect(resolveForkEntryId(messages, [], 0)).toBeNull();
  });

  it("returns null when the paired text does not match", () => {
    const messages = [user("hello")];
    expect(resolveForkEntryId(messages, [fork("e1", "different")], 0)).toBeNull();
  });

  it("returns null when the fork list is shorter than the ordinal", () => {
    const messages = [user("first"), assistant(), user("second")];
    expect(resolveForkEntryId(messages, [fork("e1", "first")], 2)).toBeNull();
  });

  it("returns null for an out-of-range index", () => {
    expect(resolveForkEntryId([user("hi")], [fork("e1", "hi")], 5)).toBeNull();
  });

  it("returns null for an empty fork list", () => {
    expect(resolveForkEntryId([user("hi")], [], 0)).toBeNull();
  });
});
