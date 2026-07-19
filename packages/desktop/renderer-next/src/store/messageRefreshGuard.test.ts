import { describe, expect, it } from "vitest";
import { shouldApplyMessageRefresh } from "./messageRefreshGuard";

const base = {
  workspaceCwd: "C:\\proj",
  generation: 3,
  isStreaming: false,
  messageCount: 4,
  activeMessageIndex: null as number | null,
};

describe("shouldApplyMessageRefresh", () => {
  it("applies matching non-streaming refreshes", () => {
    expect(shouldApplyMessageRefresh(base, {
      workspaceCwd: "C:/proj/",
      generation: 3,
      messageCount: 4,
    })).toEqual({ apply: true });
  });

  it("rejects workspace mismatches", () => {
    expect(shouldApplyMessageRefresh(base, {
      workspaceCwd: "D:\\other",
      generation: 3,
      messageCount: 4,
    })).toEqual({ apply: false, reason: "workspace-mismatch" });
  });

  it("rejects stale generations", () => {
    expect(shouldApplyMessageRefresh(base, {
      workspaceCwd: "C:\\proj",
      generation: 2,
      messageCount: 4,
    })).toEqual({ apply: false, reason: "stale-generation" });
  });

  it("rejects streaming shrinks that would drop the active tail", () => {
    expect(shouldApplyMessageRefresh({
      ...base,
      isStreaming: true,
      messageCount: 6,
      activeMessageIndex: 5,
    }, {
      workspaceCwd: "C:\\proj",
      generation: 3,
      messageCount: 4,
    })).toEqual({ apply: false, reason: "streaming-shrink" });
  });

  it("allows streaming refresh that preserves the active tail", () => {
    expect(shouldApplyMessageRefresh({
      ...base,
      isStreaming: true,
      messageCount: 3,
      activeMessageIndex: 2,
    }, {
      workspaceCwd: "C:\\proj",
      generation: 3,
      messageCount: 3,
    })).toEqual({ apply: true });
  });

  it("rejects a streaming shrink between messages when no cursor is open", () => {
    expect(shouldApplyMessageRefresh({
      ...base,
      isStreaming: true,
      activeMessageIndex: null,
    }, {
      workspaceCwd: "C:\\proj",
      generation: 3,
      messageCount: 3,
    })).toEqual({ apply: false, reason: "streaming-shrink" });
  });
});
