/**
 * Guard get_messages / refreshSession results so a stale async response cannot
 * clobber a newer streaming cursor or a different workspace.
 */

export interface MessageRefreshContext {
  workspaceCwd: string;
  generation: number;
  isStreaming: boolean;
  messageCount: number;
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
  // get_messages contains finalized messages only. While a run is active, a
  // shorter snapshot is necessarily behind the event stream, even in the gap
  // between message_end and the next message_start when there is no cursor.
  if (current.isStreaming && candidate.messageCount < current.messageCount) {
    return { apply: false, reason: "streaming-shrink" };
  }
  return { apply: true };
}

function normalizeCwd(cwd: string): string {
  return cwd.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}
