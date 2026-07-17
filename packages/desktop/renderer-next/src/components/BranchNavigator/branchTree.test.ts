import { describe, expect, it } from "vitest";
import type { SessionTreeData, SessionTreeNode } from "../../ipc/types";
import { buildBranchTreeRows } from "./branchTree";

function node(id: string, parentId: string | null, children: SessionTreeNode[] = []): SessionTreeNode {
  return {
    entry: { type: "message", id, parentId, timestamp: "2026-07-15T00:00:00.000Z" },
    children,
  };
}

describe("branch tree rows", () => {
  it("keeps tree order, depth, branch counts, and the active fork point", () => {
    const data: SessionTreeData = {
      tree: [node("root", null, [
        node("assistant", "root", [node("current-user", "assistant", [node("leaf", "current-user")])]),
        node("alternate-user", "root"),
      ])],
      leafId: "leaf",
    };

    expect(buildBranchTreeRows(data, [
      { entryId: "alternate-user", text: "Alternate" },
      { entryId: "root", text: "Start" },
      { entryId: "current-user", text: "Continue" },
    ])).toEqual([
      { entryId: "root", text: "Start", depth: 0, branchCount: 2, current: false },
      { entryId: "current-user", text: "Continue", depth: 2, branchCount: 1, current: true },
      { entryId: "alternate-user", text: "Alternate", depth: 1, branchCount: 0, current: false },
    ]);
  });

  it("ignores fork messages that are not present in the current tree", () => {
    expect(buildBranchTreeRows({ tree: [], leafId: null }, [{ entryId: "missing", text: "Missing" }])).toEqual([]);
  });
});
