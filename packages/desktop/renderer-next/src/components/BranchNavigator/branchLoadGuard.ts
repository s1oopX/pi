import { isSameWorkspace } from "../Sidebar/sidebarState";

export function isBranchLoadCurrent(
  requestId: number,
  latestRequestId: number,
  requestedSessionId: string,
  currentSessionId: string | null,
): boolean {
  return requestId === latestRequestId && requestedSessionId === currentSessionId;
}

export type BranchSessionChange =
  | { type: "refresh" }
  | { type: "reset"; cwd: string };

export function resolveBranchSessionChange(currentCwd: string, nextCwd: string): BranchSessionChange {
  return isSameWorkspace(currentCwd, nextCwd)
    ? { type: "refresh" }
    : { type: "reset", cwd: nextCwd };
}
