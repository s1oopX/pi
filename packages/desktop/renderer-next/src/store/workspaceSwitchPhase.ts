/**
 * User-facing phases while a workspace switch restarts the agent backend.
 */

export type WorkspaceSwitchPhase =
  | "idle"
  | "stopping"
  | "starting"
  | "restoring"
  | "ready"
  | "failed";

export interface WorkspaceSwitchSnapshot {
  phase: WorkspaceSwitchPhase;
  targetCwd: string | null;
  error?: string;
}

export function initialWorkspaceSwitch(): WorkspaceSwitchSnapshot {
  return { phase: "idle", targetCwd: null };
}

export function beginWorkspaceSwitch(targetCwd: string): WorkspaceSwitchSnapshot {
  return { phase: "stopping", targetCwd };
}

/**
 * Advance phase from backend status while a switch is in flight.
 * Order: stopping → starting → restoring → ready (cleared by caller).
 */
export function advanceWorkspaceSwitchPhase(
  current: WorkspaceSwitchSnapshot,
  backend: {
    ready: boolean;
    starting?: boolean;
    restarting?: boolean;
    cwd?: string;
    error?: string;
  },
  workspaceCwd: string,
  sameWorkspace: (a: string, b: string) => boolean,
): WorkspaceSwitchSnapshot {
  if (current.phase === "idle" || !current.targetCwd) return current;

  if (backend.error && !backend.ready && !backend.starting && !backend.restarting) {
    return {
      phase: "failed",
      targetCwd: current.targetCwd,
      error: backend.error,
    };
  }

  if (backend.restarting || (!backend.ready && !backend.starting && current.phase === "stopping")) {
    // Still tearing down or mid-restart
    if (backend.starting || backend.restarting) {
      return { ...current, phase: "starting" };
    }
    return { ...current, phase: "stopping" };
  }

  if (backend.starting || backend.restarting) {
    return { ...current, phase: "starting" };
  }

  if (
    backend.ready &&
    sameWorkspace(workspaceCwd, current.targetCwd) &&
    sameWorkspace(backend.cwd ?? "", current.targetCwd)
  ) {
    return { ...current, phase: "ready" };
  }

  if (backend.ready) {
    return { ...current, phase: "restoring" };
  }

  return current;
}

export function workspaceSwitchStatusLabel(
  snapshot: WorkspaceSwitchSnapshot,
  workspaceName: string,
  language: "en" | "zh-CN" = "en",
): string | null {
  if (snapshot.phase === "idle") return null;
  const name = workspaceName || (language === "zh-CN" ? "工作区" : "workspace");
  switch (snapshot.phase) {
    case "stopping":
      return language === "zh-CN"
        ? `正在关闭当前智能体…`
        : "Stopping current agent…";
    case "starting":
      return language === "zh-CN"
        ? `正在启动 ${name}…`
        : `Starting agent in ${name}…`;
    case "restoring":
      return language === "zh-CN"
        ? `正在恢复 ${name} 会话…`
        : `Restoring session in ${name}…`;
    case "ready":
      return language === "zh-CN"
        ? `已打开 ${name}`
        : `Opened ${name}`;
    case "failed":
      return language === "zh-CN"
        ? `打开失败：${snapshot.error ?? "未知错误"}`
        : `Failed to open: ${snapshot.error ?? "unknown error"}`;
    default:
      return null;
  }
}
