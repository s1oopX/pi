import { describe, expect, it } from "vitest";
import type { SessionInfo } from "../../ipc/types";
import {
  addWorkspace,
  clearOtherWorkspaces,
  filterSessions,
  getProjectNavigationItems,
  getWorkspaceDisplayParts,
  getWorkspaceName,
  getWorkspaceParentPath,
  groupSessionsByOwnership,
  hasUnloadedOrganizedThreads,
  isSameWorkspace,
  isThreadArchived,
  isThreadPinned,
  loadThreadOrganization,
  loadWorkspaces,
  organizeSessions,
  pruneThreadOrganization,
  removeWorkspace,
  removeThreadOrganization,
  saveThreadOrganization,
  saveWorkspaces,
  setThreadArchived,
  setThreadPinned,
  type ThreadOrganization,
  type WorkspaceStorage,
} from "./sidebarState";

function session(overrides: Partial<SessionInfo>): SessionInfo {
  return {
    id: overrides.id ?? "session-id",
    path: overrides.path ?? "C:\\sessions\\session.jsonl",
    cwd: overrides.cwd ?? "C:\\repo",
    created: overrides.created ?? new Date().toISOString(),
    modified: overrides.modified ?? new Date().toISOString(),
    messageCount: overrides.messageCount ?? 1,
    name: overrides.name,
    parentSessionPath: overrides.parentSessionPath,
    firstMessage: overrides.firstMessage ?? "",
    allMessagesText: overrides.allMessagesText ?? overrides.firstMessage ?? "",
  };
}

interface MemoryWorkspaceStorage extends WorkspaceStorage {
  values: Map<string, string>;
}

function memoryStorage(initialValues: Record<string, string> = {}): MemoryWorkspaceStorage {
  return {
    values: new Map(Object.entries(initialValues)),
    getItem(key) {
      return this.values.get(key) ?? null;
    },
    setItem(key, value) {
      this.values.set(key, value);
    },
  };
}

describe("sidebar state", () => {
  it("filters threads by all title or first-message terms", () => {
    const sessions = [
      session({ id: "one", name: "Fix workspace picker", firstMessage: "Desktop UI" }),
      session({ id: "two", name: "Release notes", firstMessage: "Workspace audit" }),
      session({ id: "three", name: "Other", firstMessage: "Unrelated", allMessagesText: "Hidden terminal detail" }),
    ];

    expect(filterSessions(sessions, "workspace UI").map(({ id }) => id)).toEqual(["one"]);
    expect(filterSessions(sessions, "  audit  ").map(({ id }) => id)).toEqual(["two"]);
    expect(filterSessions(sessions, "terminal detail").map(({ id }) => id)).toEqual(["three"]);
    expect(filterSessions(sessions, "")).toBe(sessions);
  });

  it("adds persistent workspaces without reordering existing entries", () => {
    const workspaces = ["C:\\Code\\Pi", "D:\\Other"];
    expect(addWorkspace(workspaces, "c:/code/pi/")).toBe(workspaces);
    expect(addWorkspace(workspaces, " E:\\New ")).toEqual(["C:\\Code\\Pi", "D:\\Other", "E:\\New"]);
    expect(isSameWorkspace("C:\\Code\\Pi", "c:/code/pi/")).toBe(true);
  });

  it("removes one workspace without affecting similarly named directories", () => {
    expect(removeWorkspace(["C:\\one\\pi", "D:\\two\\pi", "E:\\other"], "c:/one/pi/")).toEqual([
      "D:\\two\\pi",
      "E:\\other",
    ]);
  });

  it("clears all workspace entries except the current directory", () => {
    expect(clearOtherWorkspaces(["C:\\one", "D:\\current", "E:\\three"], "d:/CURRENT/")).toEqual([
      "D:\\current",
    ]);
    expect(clearOtherWorkspaces(["C:\\one"], " D:\\current ")).toEqual(["D:\\current"]);
    expect(clearOtherWorkspaces(["C:\\one"], " ")).toEqual([]);
  });

  it("persists and safely reloads workspaces", () => {
    const storage = memoryStorage();
    const workspaces = Array.from({ length: 60 }, (_, index) => `C:\\repo-${index}`);

    saveWorkspaces(storage, workspaces);
    expect(loadWorkspaces(storage)).toEqual(workspaces);

    storage.values.set("pi-studio-workspaces", "not-json");
    expect(loadWorkspaces(storage)).toEqual([]);
  });

  it("migrates the legacy recent-workspace list once", () => {
    const legacy = ["C:\\Code\\Pi", "D:\\Other", "c:/code/pi/"];
    const storage = memoryStorage({ "pi-studio-recent-workspaces": JSON.stringify(legacy) });

    expect(loadWorkspaces(storage)).toEqual(["C:\\Code\\Pi", "D:\\Other"]);
    expect(storage.values.get("pi-studio-workspaces")).toBe(JSON.stringify(["C:\\Code\\Pi", "D:\\Other"]));

    storage.values.set("pi-studio-recent-workspaces", JSON.stringify(["E:\\Ignored"]));
    expect(loadWorkspaces(storage)).toEqual(["C:\\Code\\Pi", "D:\\Other"]);

    const clearedStorage = memoryStorage({
      "pi-studio-workspaces": "[]",
      "pi-studio-recent-workspaces": JSON.stringify(["E:\\Must not return"]),
    });
    expect(loadWorkspaces(clearedStorage)).toEqual([]);
  });

  it("derives a concise workspace label", () => {
    expect(getWorkspaceName("C:\\Users\\me\\pi\\")).toBe("pi");
    expect(getWorkspaceName("/home/me/pi/")).toBe("pi");
    expect(getWorkspaceName("")).toBe("No workspace");
    expect(getWorkspaceParentPath("C:\\Users\\me\\pi\\")).toBe("C:\\Users\\me");
  });

  it("adds parent detail when workspace names collide", () => {
    const workspaces = ["C:\\one\\pi", "D:\\two\\pi", "E:\\other"];

    expect(getWorkspaceDisplayParts("C:\\one\\pi", workspaces)).toEqual({
      name: "pi",
      detail: "C:\\one",
    });
    expect(getWorkspaceDisplayParts("E:\\other", workspaces)).toEqual({ name: "other" });
  });

  it("assigns every session to exactly one project or the task list", () => {
    const task = session({ id: "task", path: "C:\\sessions\\task.jsonl", cwd: "C:\\Pi Studio\\tasks" });
    const projectOne = session({ id: "one", path: "C:\\sessions\\one.jsonl", cwd: "D:\\Code\\Pi" });
    const projectAlias = session({ id: "alias", path: "C:\\sessions\\alias.jsonl", cwd: "d:/code/pi/" });
    const projectTwo = session({ id: "two", path: "C:\\sessions\\two.jsonl", cwd: "E:\\Other" });

    const ownership = groupSessionsByOwnership(
      [task, projectOne, projectAlias, projectTwo],
      "c:/pi studio/tasks/",
    );

    expect(ownership.tasks.map(({ id }) => id)).toEqual(["task"]);
    expect(ownership.projects).toHaveLength(2);
    expect(ownership.projects[0]?.sessions.map(({ id }) => id)).toEqual(["one", "alias"]);
    expect(ownership.projects[1]?.sessions.map(({ id }) => id)).toEqual(["two"]);
    expect([
      ...ownership.tasks,
      ...ownership.projects.flatMap(({ sessions }) => sessions),
    ].map(({ id }) => id).sort()).toEqual(["alias", "one", "task", "two"]);
  });

  it("persists valid thread organization and ignores malformed entries", () => {
    const storage = memoryStorage({
      "pi-studio-thread-organization": JSON.stringify({
        pinned: ["C:\\sessions\\one.jsonl", "c:/sessions/ONE.jsonl", 1],
        archived: ["C:\\sessions\\two.jsonl", ""],
      }),
    });

    expect(loadThreadOrganization(storage)).toEqual({
      pinned: ["C:\\sessions\\one.jsonl"],
      archived: ["C:\\sessions\\two.jsonl"],
    });

    const organization: ThreadOrganization = { pinned: ["one"], archived: ["two"] };
    saveThreadOrganization(storage, organization);
    expect(storage.values.get("pi-studio-thread-organization")).toBe(JSON.stringify(organization));

    storage.values.set("pi-studio-thread-organization", "not-json");
    expect(loadThreadOrganization(storage)).toEqual({ pinned: [], archived: [] });
  });

  it("pins active threads first and keeps archived threads in their own view", () => {
    const one = session({ id: "one", path: "C:\\sessions\\one.jsonl" });
    const two = session({ id: "two", path: "C:\\sessions\\two.jsonl" });
    const three = session({ id: "three", path: "C:\\sessions\\three.jsonl" });
    const organization = {
      pinned: [three.path, one.path],
      archived: [two.path],
    };

    expect(organizeSessions([one, two, three], organization, false).map(({ id }) => id)).toEqual(["three", "one"]);
    expect(organizeSessions([one, two, three], organization, true).map(({ id }) => id)).toEqual(["two"]);
  });

  it("updates, unloads, and prunes thread organization by session path", () => {
    const one = session({ id: "one", path: "C:\\sessions\\one.jsonl" });
    const two = session({ id: "two", path: "C:\\sessions\\two.jsonl" });
    let organization = setThreadPinned({ pinned: [], archived: [] }, one.path, true);
    expect(isThreadPinned(organization, "c:/sessions/ONE.jsonl")).toBe(true);

    organization = setThreadArchived(organization, one.path, true);
    expect(isThreadPinned(organization, one.path)).toBe(false);
    expect(isThreadArchived(organization, one.path)).toBe(true);
    expect(hasUnloadedOrganizedThreads(organization, [two])).toBe(true);
    expect(pruneThreadOrganization(organization, [two])).toEqual({ pinned: [], archived: [] });

    organization = removeThreadOrganization({ pinned: [one.path], archived: [one.path] }, one.path);
    expect(organization).toEqual({ pinned: [], archived: [] });
  });

  it("shows only explicitly added projects plus the current project", () => {
    expect(getProjectNavigationItems(
      ["C:\\Code\\Pi", "C:\\Pi Studio\\tasks"],
      "D:\\Current",
      "c:/pi studio/tasks/",
    )).toEqual(["C:\\Code\\Pi", "D:\\Current"]);
    expect(getProjectNavigationItems(
      ["C:\\Code\\Pi", "C:\\Pi Studio\\tasks"],
      "C:\\PI STUDIO\\TASKS",
      "c:/pi studio/tasks/",
    )).toEqual(["C:\\Code\\Pi"]);
  });
});
