import { describe, expect, it } from "vitest";
import type { DiffFile } from "diff2html/lib/types";
import { diffFileDisplayPath, diffFileStat, summarizeDiffStats } from "./diffStats";

// Minimal DiffFile builder: the stats helpers only read names, line counts, and
// the change-kind flags, so the other required fields get inert defaults.
function diffFile(overrides: Partial<DiffFile>): DiffFile {
  return {
    oldName: "a.ts",
    newName: "a.ts",
    addedLines: 0,
    deletedLines: 0,
    isCombined: false,
    isGitDiff: true,
    language: "ts",
    blocks: [],
    ...overrides,
  } as DiffFile;
}

describe("diffFileDisplayPath", () => {
  it("prefers the new name for a modification", () => {
    expect(diffFileDisplayPath(diffFile({ oldName: "src/a.ts", newName: "src/a.ts" }))).toBe("src/a.ts");
  });

  it("uses the old name for a deletion", () => {
    expect(diffFileDisplayPath(diffFile({ oldName: "src/gone.ts", newName: "/dev/null", isDeleted: true }))).toBe(
      "src/gone.ts",
    );
  });

  it("uses the new name for an addition (old side is /dev/null)", () => {
    expect(diffFileDisplayPath(diffFile({ oldName: "/dev/null", newName: "src/new.ts", isNew: true }))).toBe(
      "src/new.ts",
    );
  });

  it("never surfaces the /dev/null sentinel", () => {
    const path = diffFileDisplayPath(diffFile({ oldName: "/dev/null", newName: "/dev/null" }));
    expect(path).not.toContain("/dev/null");
  });
});

describe("diffFileStat", () => {
  it("classifies an added file", () => {
    expect(diffFileStat(diffFile({ isNew: true, addedLines: 10 })).kind).toBe("added");
  });

  it("classifies a deleted file", () => {
    expect(diffFileStat(diffFile({ isDeleted: true, deletedLines: 8 })).kind).toBe("deleted");
  });

  it("classifies a renamed file", () => {
    expect(diffFileStat(diffFile({ isRename: true })).kind).toBe("renamed");
  });

  it("classifies a plain modification", () => {
    expect(diffFileStat(diffFile({ addedLines: 3, deletedLines: 1 })).kind).toBe("modified");
  });

  it("carries the line counts", () => {
    const stat = diffFileStat(diffFile({ addedLines: 12, deletedLines: 4 }));
    expect(stat.addedLines).toBe(12);
    expect(stat.deletedLines).toBe(4);
  });
});

describe("summarizeDiffStats", () => {
  it("returns zeros for an empty diff", () => {
    expect(summarizeDiffStats([])).toEqual({ fileCount: 0, addedLines: 0, deletedLines: 0 });
  });

  it("aggregates line counts across files", () => {
    const summary = summarizeDiffStats([
      diffFile({ addedLines: 10, deletedLines: 2 }),
      diffFile({ addedLines: 5, deletedLines: 8 }),
    ]);
    expect(summary).toEqual({ fileCount: 2, addedLines: 15, deletedLines: 10 });
  });
});
