import { describe, expect, it } from "vitest";
import { getHighlighter, highlightCode } from "./markdown";

describe("syntax highlighting", () => {
  it("loads only the requested grammars", async () => {
    const highlighter = await getHighlighter();
    expect(highlighter.getLoadedLanguages()).not.toContain("python");

    const html = await highlightCode("const answer = 42;", "js");

    expect(html).toContain("answer");
    expect(highlighter.getLoadedLanguages()).toContain("javascript");

    await highlightCode("echo ok", "bash");
    expect(highlighter.getLoadedLanguages()).toContain("shellscript");
    expect(highlighter.getLoadedLanguages()).not.toContain("python");
  });
});
