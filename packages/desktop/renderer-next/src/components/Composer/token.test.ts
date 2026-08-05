import { describe, expect, it } from "vitest";
import { getActiveToken } from "./Composer";

describe("composer token parsing", () => {
  it("resolves the full file token around the caret without consuming trailing text", () => {
    const text = "Review @src/application.ts after this";
    const caret = "Review @src/app".length;

    expect(getActiveToken(text, caret)).toEqual({
      trigger: "@",
      query: "src/app",
      start: 7,
      end: "Review @src/application.ts".length,
    });
  });

  it("resolves slash commands only while the caret is in the leading token", () => {
    expect(getActiveToken("/compact later", "/compact".length)).toEqual({
      trigger: "/",
      query: "compact",
      start: 0,
      end: "/compact".length,
    });
    expect(getActiveToken("Please /compact", "Please /compact".length)).toBeNull();
  });

  it("clamps caret positions before slicing", () => {
    expect(getActiveToken("@src", -1)).toBeNull();
    expect(getActiveToken("@src", 999)).toEqual({
      trigger: "@",
      query: "src",
      start: 0,
      end: "@src".length,
    });
  });
});
