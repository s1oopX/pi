import type { BackendEvent } from "../ipc/types";

export interface RetryActivity {
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  errorMessage: string;
  startedAt: number;
}

export interface CompactionActivity {
  reason: "manual" | "threshold" | "overflow";
}

export interface AgentActivityState {
  retryActivity: RetryActivity | null;
  compactionActivity: CompactionActivity | null;
}

export type AgentActivityEvent = Extract<
  BackendEvent,
  { type: "auto_retry_start" | "auto_retry_end" | "compaction_start" | "compaction_end" }
>;

export function reduceAgentActivity(
  state: AgentActivityState,
  event: AgentActivityEvent,
  now = Date.now(),
): AgentActivityState {
  switch (event.type) {
    case "auto_retry_start":
      return {
        ...state,
        retryActivity: {
          attempt: event.attempt,
          maxAttempts: event.maxAttempts,
          delayMs: event.delayMs,
          errorMessage: event.errorMessage,
          startedAt: now,
        },
      };
    case "auto_retry_end":
      return { ...state, retryActivity: null };
    case "compaction_start":
      return { ...state, compactionActivity: { reason: event.reason } };
    case "compaction_end":
      return { ...state, compactionActivity: null };
  }
}
