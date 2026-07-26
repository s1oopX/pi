import { describe, expect, it } from "vitest";
import type { SessionState } from "../../ipc/types";
import { shouldShowTrustBanner } from "./trustBannerState";

function session(overrides: Partial<SessionState>): SessionState {
  return {
    thinkingLevel: "medium",
    isStreaming: false,
    isCompacting: false,
    steeringMode: "all",
    followUpMode: "all",
    cwd: "C:\\work",
    sessionId: "s1",
    autoCompactionEnabled: true,
    autoRetryEnabled: true,
    isRetrying: false,
    retryAttempt: 0,
    messageCount: 0,
    pendingMessageCount: 0,
    projectTrusted: false,
    projectTrustRequired: false,
    ...overrides,
  } as SessionState;
}

describe("shouldShowTrustBanner", () => {
  it("shows only when the project requires trust and is not trusted", () => {
    expect(shouldShowTrustBanner(session({ projectTrustRequired: true, projectTrusted: false }))).toBe(true);
  });

  it("hides for trusted or resource-free projects", () => {
    expect(shouldShowTrustBanner(session({ projectTrustRequired: true, projectTrusted: true }))).toBe(false);
    expect(shouldShowTrustBanner(session({ projectTrustRequired: false, projectTrusted: false }))).toBe(false);
    expect(shouldShowTrustBanner(null)).toBe(false);
    expect(shouldShowTrustBanner(undefined)).toBe(false);
  });
});
