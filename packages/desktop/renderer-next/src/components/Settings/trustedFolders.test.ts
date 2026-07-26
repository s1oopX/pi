import { describe, expect, it } from "vitest";
import { toTrustedFolderRows } from "./trustedFolders";

describe("toTrustedFolderRows", () => {
  it("returns an empty list for missing data", () => {
    expect(toTrustedFolderRows(null)).toEqual([]);
  });

  it("sorts trusted entries first, then alphabetically, and marks the covering entry", () => {
    const rows = toTrustedFolderRows({
      entries: [
        { path: "D:\\zoo", decision: false },
        { path: "D:\\beta", decision: true },
        { path: "D:\\alpha", decision: true },
      ],
      currentPath: "D:\\beta\\sub",
      currentEntryPath: "D:\\beta",
      currentTrusted: true,
    });
    expect(rows.map((row) => row.path)).toEqual(["D:\\alpha", "D:\\beta", "D:\\zoo"]);
    expect(rows.map((row) => row.coversCurrent)).toEqual([false, true, false]);
    expect(rows[2].decision).toBe(false);
  });
});
