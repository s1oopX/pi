import type { SessionInfo } from "../../ipc/types";

const WORKSPACES_STORAGE_KEY = "pi-studio-workspaces";
const LEGACY_RECENT_WORKSPACES_STORAGE_KEY = "pi-studio-recent-workspaces";
const THREAD_ORGANIZATION_STORAGE_KEY = "pi-studio-thread-organization";

export interface WorkspaceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface ThreadOrganization {
  pinned: string[];
  archived: string[];
}

const EMPTY_THREAD_ORGANIZATION: ThreadOrganization = { pinned: [], archived: [] };

function sessionPathKey(path: string): string {
  const normalized = path.trim().replace(/\\/g, "/");
  return /^[a-z]:\//i.test(normalized) ? normalized.toLocaleLowerCase() : normalized;
}

function uniqueSessionPaths(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (typeof candidate !== "string" || !candidate.trim()) continue;
    const path = candidate.trim();
    const key = sessionPathKey(path);
    if (seen.has(key)) continue;
    seen.add(key);
    paths.push(path);
  }
  return paths;
}

function withoutSessionPath(paths: readonly string[], path: string): string[] {
  const key = sessionPathKey(path);
  return paths.filter((candidate) => sessionPathKey(candidate) !== key);
}

export function loadThreadOrganization(storage: WorkspaceStorage): ThreadOrganization {
  try {
    const raw = storage.getItem(THREAD_ORGANIZATION_STORAGE_KEY);
    if (raw === null) return EMPTY_THREAD_ORGANIZATION;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return EMPTY_THREAD_ORGANIZATION;
    const record = parsed as Record<string, unknown>;
    return {
      pinned: uniqueSessionPaths(record.pinned),
      archived: uniqueSessionPaths(record.archived),
    };
  } catch {
    return EMPTY_THREAD_ORGANIZATION;
  }
}

export function saveThreadOrganization(storage: WorkspaceStorage, organization: ThreadOrganization): void {
  try {
    storage.setItem(THREAD_ORGANIZATION_STORAGE_KEY, JSON.stringify(organization));
  } catch {
    // Thread organization is a best-effort UI convenience.
  }
}

export function setThreadPinned(
  organization: ThreadOrganization,
  path: string,
  pinned: boolean,
): ThreadOrganization {
  const nextPinned = withoutSessionPath(organization.pinned, path);
  return { ...organization, pinned: pinned ? [path, ...nextPinned] : nextPinned };
}

export function setThreadArchived(
  organization: ThreadOrganization,
  path: string,
  archived: boolean,
): ThreadOrganization {
  const nextArchived = withoutSessionPath(organization.archived, path);
  return {
    pinned: archived ? withoutSessionPath(organization.pinned, path) : organization.pinned,
    archived: archived ? [path, ...nextArchived] : nextArchived,
  };
}

export function removeThreadOrganization(organization: ThreadOrganization, path: string): ThreadOrganization {
  return {
    pinned: withoutSessionPath(organization.pinned, path),
    archived: withoutSessionPath(organization.archived, path),
  };
}

export function isThreadPinned(organization: ThreadOrganization, path: string): boolean {
  const key = sessionPathKey(path);
  return organization.pinned.some((candidate) => sessionPathKey(candidate) === key);
}

export function isThreadArchived(organization: ThreadOrganization, path: string): boolean {
  const key = sessionPathKey(path);
  return organization.archived.some((candidate) => sessionPathKey(candidate) === key);
}

export function organizeSessions(
  sessions: readonly SessionInfo[],
  organization: ThreadOrganization,
  archived: boolean,
): SessionInfo[] {
  const archivedPaths = new Set(organization.archived.map(sessionPathKey));
  const pinnedRanks = new Map(organization.pinned.map((path, index) => [sessionPathKey(path), index]));
  return sessions
    .filter((session) => archivedPaths.has(sessionPathKey(session.path)) === archived)
    .sort((left, right) => {
      const leftRank = pinnedRanks.get(sessionPathKey(left.path));
      const rightRank = pinnedRanks.get(sessionPathKey(right.path));
      if (leftRank === undefined) return rightRank === undefined ? 0 : 1;
      return rightRank === undefined ? -1 : leftRank - rightRank;
    });
}

export function hasUnloadedOrganizedThreads(
  organization: ThreadOrganization,
  sessions: readonly SessionInfo[],
): boolean {
  const loadedPaths = new Set(sessions.map((session) => sessionPathKey(session.path)));
  return [...organization.pinned, ...organization.archived]
    .some((path) => !loadedPaths.has(sessionPathKey(path)));
}

export function pruneThreadOrganization(
  organization: ThreadOrganization,
  sessions: readonly SessionInfo[],
): ThreadOrganization {
  const loadedPaths = new Set(sessions.map((session) => sessionPathKey(session.path)));
  const pinned = organization.pinned.filter((path) => loadedPaths.has(sessionPathKey(path)));
  const archived = organization.archived.filter((path) => loadedPaths.has(sessionPathKey(path)));
  return pinned.length === organization.pinned.length && archived.length === organization.archived.length
    ? organization
    : { pinned, archived };
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
