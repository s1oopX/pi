/**
 * Guard get_messages / refreshSession results so a stale async response cannot
 * clobber a newer streaming cursor or a different workspace.
 */

export interface MessageRefreshContext {
  workspaceCwd: string;
  generation: number;
  isStreaming: boolean;
  activeMessageIndex: number | null;
}

export interface MessageRefreshCandidate {
  workspaceCwd: string;
  generation: number;
  messageCount: number;
}

export type MessageRefreshDecision =
  | { apply: true }
  | { apply: false; reason: "workspace-mismatch" | "stale-generation" | "streaming-shrink" };

/**
 * Whether a completed get_messages (or light session refresh payload) may replace store.messages.
 */
export function shouldApplyMessageRefresh(
  current: MessageRefreshContext,
  candidate: MessageRefreshCandidate,
): MessageRefreshDecision {
  if (!current.workspaceCwd || !candidate.workspaceCwd) {
    return { apply: false, reason: "workspace-mismatch" };
  }
  if (normalizeCwd(current.workspaceCwd) !== normalizeCwd(candidate.workspaceCwd)) {
    return { apply: false, reason: "workspace-mismatch" };
  }
  if (candidate.generation !== current.generation) {
    return { apply: false, reason: "stale-generation" };
  }
  // While streaming, never accept a shorter transcript — that usually means a
  // refresh raced ahead of the live tail and would flash/drop the active bubble.
  if (
    current.isStreaming &&
    current.activeMessageIndex !== null &&
    candidate.messageCount < current.activeMessageIndex + 1
  ) {
    return { apply: false, reason: "streaming-shrink" };
  }
  return { apply: true };
}

function normalizeCwd(cwd: string): string {
  return cwd.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}
