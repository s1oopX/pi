import type { DiffFile } from "diff2html/lib/types";

export interface DiffFileStat {
  /** Display path: new name, or old name for deletions. */
  path: string;
  addedLines: number;
  deletedLines: number;
  /** Change kind, for an optional badge (added / deleted / renamed / modified). */
  kind: "added" | "deleted" | "renamed" | "modified";
}

export interface DiffStatsSummary {
  fileCount: number;
  addedLines: number;
  deletedLines: number;
}

// diff2html reports "/dev/null" for the absent side of an add/delete. Prefer the
// meaningful name and never surface the sentinel to the user.
function meaningfulName(name: string | undefined): string | undefined {
  const trimmed = name?.trim();
  if (!trimmed || trimmed === "/dev/null") return undefined;
  return trimmed;
}

/** Display path for a parsed diff file: new name for edits/adds, old for deletes. */
export function diffFileDisplayPath(file: DiffFile): string {
  const newName = meaningfulName(file.newName);
  const oldName = meaningfulName(file.oldName);
  if (file.isDeleted) return oldName ?? newName ?? "(unknown)";
  return newName ?? oldName ?? "(unknown)";
}

function classifyFile(file: DiffFile): DiffFileStat["kind"] {
  if (file.isNew) return "added";
  if (file.isDeleted) return "deleted";
  if (file.isRename) return "renamed";
  return "modified";
}

/** Per-file added/deleted line counts and change kind for the file header. */
export function diffFileStat(file: DiffFile): DiffFileStat {
  return {
    path: diffFileDisplayPath(file),
    addedLines: file.addedLines,
    deletedLines: file.deletedLines,
    kind: classifyFile(file),
  };
}

/** Aggregate totals across all files for the toolbar summary. */
export function summarizeDiffStats(files: readonly DiffFile[]): DiffStatsSummary {
  let addedLines = 0;
  let deletedLines = 0;
  for (const file of files) {
    addedLines += file.addedLines;
    deletedLines += file.deletedLines;
  }
  return { fileCount: files.length, addedLines, deletedLines };
}
