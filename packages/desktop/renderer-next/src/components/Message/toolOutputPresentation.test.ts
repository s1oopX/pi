import { describe, expect, it } from "vitest";
import { shouldAutoExpandToolBody, summarizeToolOutput } from "./toolOutputPresentation";

describe("summarizeToolOutput", () => {
  it("returns short output unchanged", () => {
    expect(summarizeToolOutput("ok")).toEqual({
      preview: "ok",
      truncated: false,
      lineCount: 1,
    });
  });

  it("keeps the last N lines for long bash output", () => {
    const text = Array.from({ length: 100 }, (_, i) => `L${i}`).join("\n");
    const summary = summarizeToolOutput(text, { maxLines: 5 });
    expect(summary.lineCount).toBe(100);
    expect(summary.truncated).toBe(true);
    expect(summary.preview).toContain("L95");
    expect(summary.preview).toContain("L99");
    expect(summary.preview).not.toContain("L0");
    expect(summary.preview.startsWith("…")).toBe(true);
  });

  it("clips by character budget as well", () => {
    const summary = summarizeToolOutput("x".repeat(5_000), { maxLines: 50, maxChars: 100 });
    expect(summary.truncated).toBe(true);
    expect(summary.preview.length).toBeLessThanOrEqual(100);
  });
});

describe("shouldAutoExpandToolBody", () => {
  it("auto-expands only on error when there is a body", () => {
    expect(shouldAutoExpandToolBody("error", true)).toBe(true);
    expect(shouldAutoExpandToolBody("done", true)).toBe(false);
    expect(shouldAutoExpandToolBody("running", true)).toBe(false);
    expect(shouldAutoExpandToolBody("error", false)).toBe(false);
  });
});
