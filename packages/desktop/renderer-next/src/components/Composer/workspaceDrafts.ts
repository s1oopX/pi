import type { ComposerAttachment } from "./attachments";

export interface ComposerWorkspaceDraft {
  input: string;
  attachments: ComposerAttachment[];
}

const drafts = new Map<string, ComposerWorkspaceDraft>();

function workspaceKey(cwd: string, sessionId?: string | null): string {
  const workspace = cwd.trim() || "__no_workspace__";
  return `${workspace}\u0000${sessionId ?? "__no_session__"}`;
}

export function getComposerWorkspaceDraft(cwd: string, sessionId?: string | null): ComposerWorkspaceDraft {
  const draft = drafts.get(workspaceKey(cwd, sessionId));
  return draft
    ? { input: draft.input, attachments: draft.attachments.map((attachment) => ({ ...attachment })) }
    : { input: "", attachments: [] };
}

export function setComposerWorkspaceDraft(
  cwd: string,
  sessionId: string | null,
  input: string,
  attachments: readonly ComposerAttachment[],
): void {
  const key = workspaceKey(cwd, sessionId);
  if (!input && attachments.length === 0) {
    drafts.delete(key);
    return;
  }
  drafts.set(key, {
    input,
    attachments: attachments.map((attachment) => ({ ...attachment })),
  });
}

export function clearComposerWorkspaceDraft(cwd: string, sessionId?: string | null): void {
  drafts.delete(workspaceKey(cwd, sessionId));
}

export function appendFileReference(input: string, file: string): string {
  return `${input}${input && !/\s$/.test(input) ? " " : ""}@${file} `;
}
