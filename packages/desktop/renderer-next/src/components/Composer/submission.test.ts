import { describe, expect, it } from "vitest";
import {
  isPromptSubmissionBlocked,
  resolvePromptStreamingBehavior,
  shouldSubmitComposerEnter,
} from "./submission";

describe("composer submission", () => {
  it("blocks prompts while automatic retry or compaction is active", () => {
    expect(isPromptSubmissionBlocked(true, false)).toBe(true);
    expect(isPromptSubmissionBlocked(false, true)).toBe(true);
    expect(isPromptSubmissionBlocked(false, false)).toBe(false);
  });

  it("does not submit Enter while an IME is composing", () => {
    expect(shouldSubmitComposerEnter("Enter", false, true)).toBe(false);
    expect(shouldSubmitComposerEnter("Enter", false, false)).toBe(true);
    expect(shouldSubmitComposerEnter("Enter", true, false)).toBe(false);
  });

  it("sends idle messages as plain prompts", () => {
    expect(resolvePromptStreamingBehavior(false, "Continue", "follow-up")).toBeUndefined();
    expect(resolvePromptStreamingBehavior(false, "Continue", "steer")).toBeUndefined();
  });

  it("adds the selected streaming behavior for plain messages during a run", () => {
    expect(resolvePromptStreamingBehavior(true, "Use the existing helper", "follow-up")).toBe("followUp");
    expect(resolvePromptStreamingBehavior(true, "Use the existing helper", "steer")).toBe("steer");
  });

  it("keeps slash commands as immediate prompt commands during a run", () => {
    expect(resolvePromptStreamingBehavior(true, "/compact", "follow-up")).toBeUndefined();
    expect(resolvePromptStreamingBehavior(true, "/compact", "steer")).toBeUndefined();
  });
});
