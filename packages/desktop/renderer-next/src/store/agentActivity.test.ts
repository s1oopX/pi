import { describe, expect, it } from "vitest";
import { reduceAgentActivity, type AgentActivityState } from "./agentActivity";

const idleState: AgentActivityState = {
  retryActivity: null,
  compactionActivity: null,
};

describe("reduceAgentActivity", () => {
  it("tracks retry metadata until the retry lifecycle ends", () => {
    const retrying = reduceAgentActivity(idleState, {
      type: "auto_retry_start",
      attempt: 2,
      maxAttempts: 3,
      delayMs: 4000,
      errorMessage: "rate limited",
    }, 1000);

    expect(retrying.retryActivity).toEqual({
      attempt: 2,
      maxAttempts: 3,
      delayMs: 4000,
      errorMessage: "rate limited",
      startedAt: 1000,
    });
    expect(reduceAgentActivity(retrying, {
      type: "auto_retry_end",
      success: false,
      attempt: 2,
      finalError: "Retry cancelled",
    })).toEqual(idleState);
  });

  it("tracks compaction independently from retry state", () => {
    const retrying = reduceAgentActivity(idleState, {
      type: "auto_retry_start",
      attempt: 1,
      maxAttempts: 3,
      delayMs: 2000,
      errorMessage: "server error",
    });
    const compacting = reduceAgentActivity(retrying, {
      type: "compaction_start",
      reason: "overflow",
    });

    expect(compacting.compactionActivity).toEqual({ reason: "overflow" });
    expect(compacting.retryActivity).toBe(retrying.retryActivity);
    expect(reduceAgentActivity(compacting, {
      type: "compaction_end",
      reason: "overflow",
      aborted: false,
      willRetry: true,
    })).toEqual(retrying);
  });
});
