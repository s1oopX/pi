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
    expect(markup).toContain("tone-working");
  });

  it("keeps a live status tail while streaming after process content", () => {
    const markup = renderToStaticMarkup(createElement(MessageBubble, {
      message: assistantMessage([
        {
          type: "toolCall",
          id: "call-1",
          name: "read",
          arguments: { path: "src/App.tsx" },
        },
        { type: "text", text: "Still going." },
      ]),
      streaming: true,
      toolExecutionsByCallId: {
        "call-1": { toolName: "read", phase: "done" },
      },
    }));
    expect(markup).toContain("Still going.");
    expect(markup).toContain("agent-working-tail");
    expect(markup).toContain("agent-working-primary");
    // Default store has no activeTool → plain Working…
    expect(markup).toContain("Working…");
  });

  it("expands file changes with a reconstructed diff preview", () => {
    const markup = renderToStaticMarkup(createElement(MessageBubble, {
      message: assistantMessage([
        {
          type: "toolCall",
          id: "write-1",
          name: "write",
          arguments: { path: "src/new.ts", content: "export const n = 1;\n" },
        },
      ]),
      toolExecutionsByCallId: {
        "write-1": { toolName: "write", phase: "done" },
      },
      resultsByCallId: new Map([
        ["write-1", {
          role: "toolResult" as const,
          toolCallId: "write-1",
          toolName: "write",
          content: [{ type: "text" as const, text: "Successfully wrote 18 bytes to src/new.ts" }],
          isError: false,
          timestamp: 2,
        }],
      ]),
    }));
    expect(markup).toContain("Changed 1 file");
    expect(markup).toContain("src/new.ts");
    // Single-file groups open by default so the preview is immediately scannable.
    expect(markup).toContain("file-changes-diff");
    expect(markup).toContain("diff-view");
  });

  it("shows a running indicator without a done status label", () => {
    const markup = renderToStaticMarkup(createElement(MessageBubble, {
      message: assistantMessage([
        {
          type: "toolCall",
          id: "bash-1",
          name: "bash",
          arguments: { command: "npm test" },
        },
      ]),
      streaming: true,
      toolExecutionsByCallId: {
        "bash-1": { toolName: "bash", phase: "running" },
      },
    }));
    expect(markup).toContain("tool-call-running-dot");
    expect(markup).toContain("Running");
    expect(markup).not.toContain("tool-call-status-running");
    expect(markup).not.toContain("tool-call-status-done");
  });

  it("does not mark answer as after-process when there was no process", () => {
    const markup = renderToStaticMarkup(createElement(MessageBubble, {
      message: assistantMessage([{ type: "text", text: "Hello only." }]),
      toolExecutionsByCallId: {},
    }));
    expect(markup).toContain("Hello only.");
    expect(markup).toContain("message-answer");
    expect(markup).not.toContain("after-process");
  });

  it("collapses long tool output by default and expands errors", () => {
    const longOutput = Array.from({ length: 20 }, (_, i) => `line-${i}`).join("\n");
    const doneMarkup = renderToStaticMarkup(createElement(MessageBubble, {
      message: assistantMessage([
        {
          type: "toolCall",
          id: "bash-1",
          name: "bash",
          arguments: { command: "npm test" },
        },
      ]),
      toolExecutionsByCallId: {
        "bash-1": { toolName: "bash", phase: "done" },
      },
      resultsByCallId: new Map([
        ["bash-1", {
          role: "toolResult" as const,
          toolCallId: "bash-1",
          toolName: "bash",
          content: [{ type: "text" as const, text: longOutput }],
          isError: false,
          timestamp: 2,
        }],
      ]),
    }));
    // Collapsed: full body not present; header still scannable.
    expect(doneMarkup).toContain("Ran");
    expect(doneMarkup).not.toContain("line-0");
    expect(doneMarkup).not.toContain("tool-call-body");

    const errorMarkup = renderToStaticMarkup(createElement(MessageBubble, {
      message: assistantMessage([
        {
          type: "toolCall",
          id: "bash-2",
          name: "bash",
          arguments: { command: "npm test" },
        },
      ]),
      toolExecutionsByCallId: {
        "bash-2": { toolName: "bash", phase: "error" },
      },
      resultsByCallId: new Map([
        ["bash-2", {
          role: "toolResult" as const,
          toolCallId: "bash-2",
          toolName: "bash",
          content: [{ type: "text" as const, text: longOutput }],
          isError: true,
          timestamp: 2,
        }],
      ]),
    }));
    expect(errorMarkup).toContain("tool-call-body");
    expect(errorMarkup).toContain("line-19");
    expect(errorMarkup).toContain("tool-call-status-error");
  });
});
