import { describe, expect, it } from "vitest";
import { addDiffLineAnchors } from "./lineAnchors";

describe("addDiffLineAnchors", () => {
  it("turns rendered old and new line numbers into accessible buttons", () => {
    const markup = '<div class="line-num1">7</div><div class="line-num2">9</div><span>code</span>';
    const result = addDiffLineAnchors(markup, "Comment on old line", "Comment on new line");

    expect(result).toContain('data-diff-side="old" data-diff-line="7"');
    expect(result).toContain('aria-label="Comment on new line 9"');
    expect(result).toContain("<span>code</span>");
  });

  it("leaves blank line-number placeholders unchanged", () => {
    expect(addDiffLineAnchors('<div class="line-num1"></div>', "Old", "New"))
      .toBe('<div class="line-num1"></div>');
  });
});
