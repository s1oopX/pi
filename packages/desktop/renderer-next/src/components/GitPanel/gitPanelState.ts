import type { WorkspaceGitStatus } from "../../ipc/types";

export interface GitSyncSummary {
  /** Show an ahead/behind badge at all. */
  show: boolean;
  ahead: number;
  behind: number;
  /** The branch has a configured upstream. */
  hasUpstream: boolean;
  /** Push is meaningful: a repository on a branch (not detached). */
  canPush: boolean;
}

export function summarizeGitSync(status: WorkspaceGitStatus | null | undefined): GitSyncSummary {
  if (!status || status.kind !== "repository" || status.detached) {
    return { show: false, ahead: 0, behind: 0, hasUpstream: false, canPush: false };
  }
  const ahead = Math.max(0, status.ahead ?? 0);
  const behind = Math.max(0, status.behind ?? 0);
  return {
    show: ahead > 0 || behind > 0,
    ahead,
    behind,
    hasUpstream: Boolean(status.upstream),
    canPush: Boolean(status.branch),
  };
}
