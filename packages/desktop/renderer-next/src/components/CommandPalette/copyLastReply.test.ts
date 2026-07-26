import { describe, expect, it } from "vitest";
import type { Message } from "../../ipc/types";
import { findLastReplyCopyText } from "./copyLastReply";

function message(role: string, content: unknown): Message {
  return { role, content } as unknown as Message;
}

describe("findLastReplyCopyText", () => {
  it("returns the text blocks of the latest assistant reply", () => {
    const messages = [
      message("user", [{ type: "text", text: "question" }]),
      message("assistant", [
        { type: "thinking", thinking: "hidden" },
        { type: "text", text: "First part." },
        { type: "text", text: "Second part." },
      ]),
    ];
    expect(findLastReplyCopyText(messages)).toBe("First part.\n\nSecond part.");
  });

  it("skips trailing tool-only assistant turns and user messages", () => {
    const messages = [
      message("assistant", [{ type: "text", text: "The real answer." }]),
      message("assistant", [{ type: "toolCall", id: "c1", name: "bash", arguments: {} }]),
      message("user", [{ type: "text", text: "follow-up" }]),
    ];
    expect(findLastReplyCopyText(messages)).toBe("The real answer.");
  });

  it("returns null when no assistant text exists", () => {
    expect(findLastReplyCopyText([])).toBeNull();
    expect(findLastReplyCopyText([message("user", [{ type: "text", text: "hi" }])])).toBeNull();
  });
});
