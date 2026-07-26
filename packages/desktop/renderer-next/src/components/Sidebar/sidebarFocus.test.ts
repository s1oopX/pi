import { describe, expect, it } from "vitest";
import { nextRovingIndex } from "./sidebarFocus";

describe("nextRovingIndex", () => {
  it("wraps arrows and jumps with Home/End", () => {
    expect(nextRovingIndex(3, 0, "ArrowDown")).toBe(1);
    expect(nextRovingIndex(3, 2, "ArrowDown")).toBe(0);
    expect(nextRovingIndex(3, 0, "ArrowUp")).toBe(2);
    expect(nextRovingIndex(3, 1, "Home")).toBe(0);
    expect(nextRovingIndex(3, 1, "End")).toBe(2);
  });

  it("ignores unrelated keys and empty lists", () => {
    expect(nextRovingIndex(3, 1, "Enter")).toBeNull();
    expect(nextRovingIndex(0, 0, "ArrowDown")).toBeNull();
  });

  it("recovers when the current item vanished (-1 index)", () => {
    expect(nextRovingIndex(3, -1, "ArrowDown")).toBe(0);
    expect(nextRovingIndex(3, -1, "ArrowUp")).toBe(1);
  });
});
