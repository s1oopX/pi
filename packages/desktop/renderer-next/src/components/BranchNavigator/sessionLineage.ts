import type { SessionInfo } from "../../ipc/types";

export interface SessionLineageRow {
  path: string;
  id: string;
  title: string;
  detail: string;
  depth: number;
  current: boolean;
  childCount: number;
}

function sessionTime(value: string): number {
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function sessionTitle(session: SessionInfo, fallback: string): string {
  return session.name?.trim() || session.firstMessage.trim() || fallback;
}

export function buildSessionLineageRows(
  sessions: readonly SessionInfo[],
  currentSessionId: string | null,
  fallbackTitle: string,
): SessionLineageRow[] {
  if (!currentSessionId) return [];

  const byPath = new Map(sessions.map((session) => [session.path, session]));
  const current = sessions.find((session) => session.id === currentSessionId);
  if (!current) return [];

  const childrenByParentPath = new Map<string, SessionInfo[]>();
  for (const session of sessions) {
    if (!session.parentSessionPath || !byPath.has(session.parentSessionPath)) continue;
    const children = childrenByParentPath.get(session.parentSessionPath) ?? [];
    children.push(session);
    childrenByParentPath.set(session.parentSessionPath, children);
  }
  for (const children of childrenByParentPath.values()) {
    children.sort((left, right) => sessionTime(left.created) - sessionTime(right.created));
  }

  let root = current;
  const visited = new Set<string>();
  while (root.parentSessionPath && byPath.has(root.parentSessionPath) && !visited.has(root.path)) {
    visited.add(root.path);
    const parent = byPath.get(root.parentSessionPath);
    if (!parent) break;
    root = parent;
  }

  const rows: SessionLineageRow[] = [];
  const visit = (session: SessionInfo, depth: number) => {
    const children = childrenByParentPath.get(session.path) ?? [];
    rows.push({
      path: session.path,
      id: session.id,
      title: sessionTitle(session, fallbackTitle),
      detail: session.cwd,
      depth,
      current: session.id === currentSessionId,
      childCount: children.length,
    });
    for (const child of children) visit(child, depth + 1);
  };
  visit(root, 0);

  return rows;
}
