import { describe, expect, it } from "vitest";
import { resolvePromptStreamingBehavior } from "./submission";

describe("composer submission", () => {
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
