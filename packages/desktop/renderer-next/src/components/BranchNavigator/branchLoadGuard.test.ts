import { describe, expect, it } from "vitest";
import { isBranchLoadCurrent } from "./branchLoadGuard";

describe("branch load guard", () => {
  it("accepts only the latest request for the session that started it", () => {
    expect(isBranchLoadCurrent(3, 3, "session-a", "session-a")).toBe(true);
    expect(isBranchLoadCurrent(2, 3, "session-a", "session-a")).toBe(false);
    expect(isBranchLoadCurrent(3, 3, "session-a", "session-b")).toBe(false);
    expect(isBranchLoadCurrent(3, 3, "session-a", null)).toBe(false);
  });
});
