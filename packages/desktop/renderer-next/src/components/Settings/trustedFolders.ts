import type { ProjectTrustEntries, ProjectTrustEntry } from "../../ipc/types";

export interface TrustedFolderRow extends ProjectTrustEntry {
  /** True when this store entry is the one covering the current workspace. */
  coversCurrent: boolean;
}

/** Trusted entries first, then alphabetical; marks the entry covering the workspace. */
export function toTrustedFolderRows(data: ProjectTrustEntries | null): TrustedFolderRow[] {
  if (!data) return [];
  return [...data.entries]
    .sort((a, b) => Number(b.decision) - Number(a.decision) || a.path.localeCompare(b.path))
    .map((entry) => ({ ...entry, coversCurrent: entry.path === data.currentEntryPath }));
}
