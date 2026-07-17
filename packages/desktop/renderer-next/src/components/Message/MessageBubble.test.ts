import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { setLanguagePreference } from "../../i18n";
import type { Message } from "../../ipc/types";
import { getMarkdownCodeLanguage, MessageBubble } from "./MessageBubble";

beforeEach(() => setLanguagePreference("en", null));

describe("markdown code presentation", () => {
  it("recognizes fenced code without a language as a block", () => {
    expect(getMarkdownCodeLanguage(undefined, "const answer = 42;\n")).toBe("");
  });

  it("keeps inline code inline and preserves explicit languages", () => {
    expect(getMarkdownCodeLanguage(undefined, "answer")).toBeNull();
    expect(getMarkdownCodeLanguage("language-typescript", "const answer = 42;\n")).toBe("typescript");
    expect(getMarkdownCodeLanguage("language-c++", "int main() {}\n")).toBe("c++");
  });
});

describe("message localization", () => {
  it("localizes application controls without changing message content", () => {
    setLanguagePreference("zh-CN", null);
    const message: Message = { role: "user", content: "npm run check", timestamp: 1 };
    const markup = renderToStaticMarkup(createElement(MessageBubble, {
      message,
      toolExecutionsByCallId: {},
    }));

    expect(markup).toContain(">你</span>");
    expect(markup).toContain('aria-label="复制消息"');
    expect(markup).toContain("npm run check");
  });
});

function assistantMessage(content: Extract<Message, { role: "assistant" }>["content"]): Message {
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
    stopReason: "stop",
    timestamp: 1,
  };
}

describe("Codex-style process presentation", () => {
  it("renders thinking and tools as process rows with restrained status", () => {
    const message = assistantMessage([
      { type: "thinking", thinking: "Plan the change." },
      {
        type: "toolCall",
        id: "call-1",
        name: "read",
        arguments: { path: "src/App.tsx" },
      },
      { type: "text", text: "Done." },
    ]);
    const markup = renderToStaticMarkup(createElement(MessageBubble, {
      message,
      toolExecutionsByCallId: {
        "call-1": { toolName: "read", phase: "done" },
      },
      resultsByCallId: new Map([
        ["call-1", {
          role: "toolResult" as const,
          toolCallId: "call-1",
          toolName: "read",
          content: [{ type: "text" as const, text: "ok" }],
          isError: false,
          timestamp: 2,
        }],
      ]),
    }));

    expect(markup).toContain("Thought for a moment");
    expect(markup).toContain("Read");
    expect(markup).toContain("src/App.tsx");
    expect(markup).toContain("message-answer after-process");
    expect(markup).toContain("Done.");
    // Done tools do not show a textual status badge.
    expect(markup).not.toContain("tool-call-status-done");
  });

  it("shows Working placeholder while streaming an empty assistant turn", () => {
    const markup = renderToStaticMarkup(createElement(MessageBubble, {
      message: assistantMessage([]),
      streaming: true,
      toolExecutionsByCallId: {},
    }));
    expect(markup).toContain("Working…");
    expect(markup).toContain("agent-working");
  });
});
