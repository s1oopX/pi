import { describe, expect, it } from "vitest";
import type { SessionState } from "../../ipc/types";
import { hasStatusBarContent } from "./StatusBar";

function session(overrides: Partial<SessionState>): SessionState {
  return overrides as SessionState;
}

describe("hasStatusBarContent", () => {
  it("shows the pending footer only when pending messages are not already covered by run state", () => {
    expect(hasStatusBarContent({
      session: session({ pendingMessageCount: 2 }),
      isStreaming: false,
      compactionActivity: null,
    })).toBe(true);

    expect(hasStatusBarContent({
      session: session({ pendingMessageCount: 2 }),
      isStreaming: true,
      compactionActivity: null,
    })).toBe(false);

    expect(hasStatusBarContent({
      session: session({ pendingMessageCount: 2, isCompacting: true }),
      isStreaming: false,
      compactionActivity: null,
    })).toBe(false);
  });
});
