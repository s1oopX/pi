import { describe, expect, it } from "vitest";
import type { SessionInfo } from "../../ipc/types";
import { buildSessionLineageRows } from "./sessionLineage";

function session(overrides: Partial<SessionInfo> & Pick<SessionInfo, "id" | "path">): SessionInfo {
  return {
    id: overrides.id,
    path: overrides.path,
    cwd: overrides.cwd ?? "C:\\workspace",
    name: overrides.name,
    parentSessionPath: overrides.parentSessionPath,
    created: overrides.created ?? "2026-07-15T00:00:00.000Z",
    modified: overrides.modified ?? "2026-07-15T00:00:00.000Z",
    messageCount: overrides.messageCount ?? 1,
    firstMessage: overrides.firstMessage ?? "",
    allMessagesText: overrides.allMessagesText ?? "",
  };
}

describe("session lineage rows", () => {
  it("renders the current session lineage subtree from the root parent", () => {
    const rows = buildSessionLineageRows([
      session({ id: "root", path: "root.jsonl", name: "Root", created: "2026-07-15T00:00:00.000Z" }),
      session({
        id: "child-a",
        path: "child-a.jsonl",
        firstMessage: "Child A",
        parentSessionPath: "root.jsonl",
        created: "2026-07-15T00:01:00.000Z",
      }),
      session({
        id: "child-b",
        path: "child-b.jsonl",
        firstMessage: "Child B",
        parentSessionPath: "root.jsonl",
        created: "2026-07-15T00:02:00.000Z",
      }),
      session({
        id: "grandchild",
        path: "grandchild.jsonl",
        parentSessionPath: "child-b.jsonl",
        created: "2026-07-15T00:03:00.000Z",
      }),
      session({ id: "other", path: "other.jsonl", name: "Other" }),
    ], "grandchild", "Untitled");

    expect(rows).toEqual([
      {
        path: "root.jsonl",
        id: "root",
        title: "Root",
        detail: "C:\\workspace",
        depth: 0,
        current: false,
        childCount: 2,
      },
      {
        path: "child-a.jsonl",
        id: "child-a",
        title: "Child A",
        detail: "C:\\workspace",
        depth: 1,
        current: false,
        childCount: 0,
      },
      {
        path: "child-b.jsonl",
        id: "child-b",
        title: "Child B",
        detail: "C:\\workspace",
        depth: 1,
        current: false,
        childCount: 1,
      },
      {
        path: "grandchild.jsonl",
        id: "grandchild",
        title: "Untitled",
        detail: "C:\\workspace",
        depth: 2,
        current: true,
        childCount: 0,
      },
    ]);
  });

  it("returns an empty list when the current session is not in the loaded page", () => {
    expect(buildSessionLineageRows([session({ id: "other", path: "other.jsonl" })], "missing", "Untitled")).toEqual([]);
  });

  it("keeps lineage rows when a branch lives in another workspace", () => {
    const rows = buildSessionLineageRows([
      session({ id: "root", path: "root.jsonl", cwd: "C:\\source", name: "Source" }),
      session({
        id: "child",
        path: "child.jsonl",
        cwd: "D:\\target",
        parentSessionPath: "root.jsonl",
        name: "Target",
      }),
    ], "child", "Untitled");

    expect(rows.map(({ path, detail, current }) => ({ path, detail, current }))).toEqual([
      { path: "root.jsonl", detail: "C:\\source", current: false },
      { path: "child.jsonl", detail: "D:\\target", current: true },
    ]);
  });
});
