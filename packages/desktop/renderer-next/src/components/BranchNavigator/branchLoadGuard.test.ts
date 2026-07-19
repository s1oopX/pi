import { describe, expect, it } from "vitest";
import { isBranchLoadCurrent, resolveBranchSessionChange } from "./branchLoadGuard";

describe("branch load guard", () => {
  it("accepts only the latest request for the session that started it", () => {
    expect(isBranchLoadCurrent(3, 3, "session-a", "session-a")).toBe(true);
    expect(isBranchLoadCurrent(2, 3, "session-a", "session-a")).toBe(false);
    expect(isBranchLoadCurrent(3, 3, "session-a", "session-b")).toBe(false);
    expect(isBranchLoadCurrent(3, 3, "session-a", null)).toBe(false);
  });

  it("refreshes when a branch stays in the same workspace", () => {
    expect(resolveBranchSessionChange("C:\\Project", "c:/project/")).toEqual({ type: "refresh" });
  });

  it("resets the workspace when a branch points at another workspace", () => {
    expect(resolveBranchSessionChange("C:\\Project", "D:\\Other")).toEqual({
      type: "reset",
      cwd: "D:\\Other",
    });
  });
});
