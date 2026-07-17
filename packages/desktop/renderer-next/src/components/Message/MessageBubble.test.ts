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
