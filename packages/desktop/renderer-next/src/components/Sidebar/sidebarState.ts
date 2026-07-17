import type { SessionInfo } from "../../ipc/types";

const WORKSPACES_STORAGE_KEY = "pi-studio-workspaces";
const LEGACY_RECENT_WORKSPACES_STORAGE_KEY = "pi-studio-recent-workspaces";

export interface WorkspaceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function workspaceComparisonKey(cwd: string): string {
  const normalized = cwd.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  return /^[a-z]:\//i.test(normalized) ? normalized.toLocaleLowerCase() : normalized;
}

export function isSameWorkspace(left: string, right: string): boolean {
  return workspaceComparisonKey(left) === workspaceComparisonKey(right);
}

export function getWorkspaceName(cwd: string): string {
  const normalized = cwd.trim().replace(/[\\/]+$/, "");
  if (!normalized) return "No workspace";
  return normalized.split(/[\\/]/).filter(Boolean).pop() ?? normalized;
}

export function getWorkspaceParentPath(cwd: string): string {
  const normalized = cwd.trim().replace(/[\\/]+$/, "");
  const name = getWorkspaceName(normalized);
  if (!normalized || name === normalized) return "";
  return normalized.slice(0, Math.max(0, normalized.length - name.length)).replace(/[\\/]+$/, "");
}

export function getWorkspaceDisplayParts(cwd: string, workspaces: readonly string[]): { name: string; detail?: string } {
  const name = getWorkspaceName(cwd);
  const duplicateCount = workspaces.filter((workspace) => getWorkspaceName(workspace) === name).length;
  if (duplicateCount <= 1) return { name };
  const detail = getWorkspaceParentPath(cwd);
  return detail ? { name, detail } : { name };
}

export function filterSessions(sessions: SessionInfo[], query: string): SessionInfo[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return sessions;

  return sessions.filter((session) => {
    const searchableText = [session.name, session.firstMessage, session.allMessagesText]
      .filter((value): value is string => typeof value === "string")
      .join("\n")
      .toLocaleLowerCase();
    return terms.every((term) => searchableText.includes(term));
  });
}

export interface SessionOwnership {
  tasks: SessionInfo[];
  projects: Array<{ cwd: string; sessions: SessionInfo[] }>;
}

export function groupSessionsByOwnership(sessions: SessionInfo[], taskCwd: string): SessionOwnership {
  const ownership: SessionOwnership = { tasks: [], projects: [] };
  for (const session of sessions) {
    if (taskCwd && isSameWorkspace(session.cwd, taskCwd)) {
      ownership.tasks.push(session);
      continue;
    }
    const project = ownership.projects.find((candidate) => isSameWorkspace(candidate.cwd, session.cwd));
    if (project) project.sessions.push(session);
    else ownership.projects.push({ cwd: session.cwd, sessions: [session] });
  }
  return ownership;
}

export function getProjectNavigationItems(
  workspaces: string[],
  currentCwd: string,
  taskCwd: string,
): string[] {
  let projects = workspaces.filter((cwd) => !taskCwd || !isSameWorkspace(cwd, taskCwd));
  if (currentCwd && (!taskCwd || !isSameWorkspace(currentCwd, taskCwd))) {
    projects = addWorkspace(projects, currentCwd);
  }
  return projects;
}

export function addWorkspace(workspaces: string[], cwd: string): string[] {
  const trimmedCwd = cwd.trim();
  if (!trimmedCwd || workspaces.some((candidate) => isSameWorkspace(candidate, trimmedCwd))) return workspaces;

  return [...workspaces, trimmedCwd];
}

export function removeWorkspace(workspaces: string[], cwd: string): string[] {
  return workspaces.filter((candidate) => !isSameWorkspace(candidate, cwd));
}

export function clearOtherWorkspaces(workspaces: string[], currentCwd: string): string[] {
  const trimmedCurrentCwd = currentCwd.trim();
  if (!trimmedCurrentCwd) return [];
  const currentWorkspace = workspaces.find((candidate) => isSameWorkspace(candidate, currentCwd));
  return [currentWorkspace ?? trimmedCurrentCwd];
}

function parseWorkspaceList(value: string | null): string[] | null {
  if (value === null) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    const workspaces: string[] = [];
    for (const value of parsed) {
      if (typeof value !== "string" || value.trim().length === 0) continue;
      if (workspaces.some((cwd) => isSameWorkspace(cwd, value))) continue;
      workspaces.push(value.trim());
    }
    return workspaces;
  } catch {
    return [];
  }
}

export function loadWorkspaces(storage: WorkspaceStorage): string[] {
  const workspaces = parseWorkspaceList(storage.getItem(WORKSPACES_STORAGE_KEY));
  if (workspaces !== null) return workspaces;

  const legacyWorkspaces = parseWorkspaceList(storage.getItem(LEGACY_RECENT_WORKSPACES_STORAGE_KEY)) ?? [];
  saveWorkspaces(storage, legacyWorkspaces);
  return legacyWorkspaces;
}

export function saveWorkspaces(storage: WorkspaceStorage, workspaces: string[]): void {
  try {
    storage.setItem(WORKSPACES_STORAGE_KEY, JSON.stringify(workspaces));
  } catch {
    // The workspace list is a best-effort UI convenience.
  }
}
