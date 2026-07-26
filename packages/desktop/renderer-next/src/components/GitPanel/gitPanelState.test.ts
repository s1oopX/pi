import { describe, expect, it } from "vitest";
import type { WorkspaceGitStatus } from "../../ipc/types";
import { summarizeGitSync } from "./gitPanelState";

function status(overrides: Partial<WorkspaceGitStatus>): WorkspaceGitStatus {
  return {
    cwd: "C:\\work",
    kind: "repository",
    branch: "main",
    detached: false,
    dirty: false,
    upstream: "origin/main",
    ahead: 0,
    behind: 0,
    ...overrides,
  };
}

describe("summarizeGitSync", () => {
  it("hides the badge when in sync but still allows push", () => {
    const summary = summarizeGitSync(status({}));
    expect(summary.show).toBe(false);
    expect(summary.canPush).toBe(true);
    expect(summary.hasUpstream).toBe(true);
  });

  it("shows the badge when ahead or behind", () => {
    expect(summarizeGitSync(status({ ahead: 2 })).show).toBe(true);
    expect(summarizeGitSync(status({ behind: 3 })).show).toBe(true);
    expect(summarizeGitSync(status({ ahead: 1, behind: 1 }))).toMatchObject({ show: true, ahead: 1, behind: 1 });
  });

  it("reports no upstream (first push scenario)", () => {
    const summary = summarizeGitSync(status({ upstream: null, ahead: 0, behind: 0 }));
    expect(summary.hasUpstream).toBe(false);
    expect(summary.canPush).toBe(true);
  });

  it("disables push and badge on detached HEAD or non-repository", () => {
    expect(summarizeGitSync(status({ detached: true, branch: null })).canPush).toBe(false);
    expect(summarizeGitSync(status({ kind: "not-repository" })).canPush).toBe(false);
    expect(summarizeGitSync(null).show).toBe(false);
  });
});
