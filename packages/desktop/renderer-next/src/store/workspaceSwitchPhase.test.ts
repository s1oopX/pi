import { describe, expect, it } from "vitest";
import {
  advanceWorkspaceSwitchPhase,
  beginWorkspaceSwitch,
  initialWorkspaceSwitch,
  workspaceSwitchStatusLabel,
} from "./workspaceSwitchPhase";

const same = (a: string, b: string) => a.replace(/\\/g, "/").toLowerCase() === b.replace(/\\/g, "/").toLowerCase();

describe("workspaceSwitchPhase", () => {
  it("starts in stopping", () => {
    expect(beginWorkspaceSwitch("C:\\next")).toEqual({
      phase: "stopping",
      targetCwd: "C:\\next",
    });
  });

  it("advances stopping → starting → restoring → ready", () => {
    let snap = beginWorkspaceSwitch("C:\\next");
    snap = advanceWorkspaceSwitchPhase(snap, { ready: false, restarting: true }, "C:\\old", same);
    expect(snap.phase).toBe("starting");

    snap = advanceWorkspaceSwitchPhase(snap, { ready: true, cwd: "C:\\other" }, "C:\\other", same);
    expect(snap.phase).toBe("restoring");

    snap = advanceWorkspaceSwitchPhase(
      snap,
      { ready: true, cwd: "C:\\next" },
      "C:\\next",
      same,
    );
    expect(snap.phase).toBe("ready");
  });

  it("marks failed when backend errors while offline", () => {
    let snap = beginWorkspaceSwitch("C:\\next");
    snap = advanceWorkspaceSwitchPhase(
      snap,
      { ready: false, error: "spawn failed" },
      "C:\\old",
      same,
    );
    expect(snap.phase).toBe("failed");
    expect(snap.error).toBe("spawn failed");
  });

  it("localizes status labels", () => {
    const snap = beginWorkspaceSwitch("C:\\proj");
    expect(workspaceSwitchStatusLabel(snap, "proj", "en")).toContain("Stopping");
    expect(workspaceSwitchStatusLabel({ ...snap, phase: "starting" }, "proj", "zh-CN")).toContain("启动");
  });

  it("idle has no label", () => {
    expect(workspaceSwitchStatusLabel(initialWorkspaceSwitch(), "x")).toBeNull();
  });
});
