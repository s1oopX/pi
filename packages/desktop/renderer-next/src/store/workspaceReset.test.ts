import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../ipc/api";
import type { SessionInfo } from "../ipc/types";
import { useStore } from ".";

const GLOBAL_SESSION: SessionInfo = {
  id: "global-session",
  path: "C:\\sessions\\global-session.jsonl",
  cwd: "C:\\initial",
  created: "2026-07-15T00:00:00.000Z",
  modified: "2026-07-15T00:00:00.000Z",
  messageCount: 1,
  firstMessage: "Global session",
  allMessagesText: "Global session",
};

describe("workspace reset", () => {
  beforeEach(() => {
    useStore.setState({
      taskCwd: "C:\\pi-studio\\tasks",
      sessions: [],
      sessionsTotal: 0,
      sessionsHasMore: false,
      sessionsNextOffset: null,
      sessionsQuery: "",
      sessionsLoading: false,
      sessionsError: null,
      backendStatus: {
        ready: false,
        starting: false,
        restarting: false,
        retryInMs: 0,
        restartAttempts: 0,
        backendPath: "",
        cwd: "",
      },
    });
    useStore.getState().resetForWorkspace("C:\\initial");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("clears workspace-scoped UI and backend caches", () => {
    useStore.setState({
      workspaceFiles: ["src/index.ts"],
      composerDraft: "unfinished prompt",
      queuedSteering: ["steer"],
      queuedFollowUp: ["follow up"],
      activeMessageIndex: 3,
      isStreaming: true,
      sessions: [GLOBAL_SESSION],
      sessionsTotal: 1,
    });
    useStore.getState().startToolExecution("call-1", "read");
    useStore.getState().updateAgentActivity({
      type: "auto_retry_start",
      attempt: 1,
      maxAttempts: 3,
      delayMs: 2000,
      errorMessage: "server error",
    });
    useStore.getState().updateAgentActivity({ type: "compaction_start", reason: "manual" });

    useStore.getState().resetForWorkspace("D:\\next");

    expect(useStore.getState()).toMatchObject({
      workspaceCwd: "D:\\next",
      workspaceFiles: [],
      session: null,
      messages: [],
      sessions: [GLOBAL_SESSION],
      sessionsTotal: 1,
      models: [],
      commands: [],
      composerDraft: null,
      queuedSteering: [],
      queuedFollowUp: [],
      activeMessageIndex: null,
      isStreaming: false,
      activeTool: null,
      toolExecutionsByCallId: {},
      retryActivity: null,
      compactionActivity: null,
    });
  });

  it("clears Git loading when the latest response belongs to another workspace", async () => {
    vi.spyOn(api, "getWorkspaceGitStatus").mockResolvedValueOnce({
      cwd: "C:\\stale",
      kind: "repository",
      branch: "main",
      detached: false,
      dirty: false,
    });
    useStore.setState({
      workspaceCwd: "D:\\current",
      workspaceGitStatus: null,
      workspaceGitStatusLoading: false,
    });

    useStore.getState().refreshWorkspaceGitStatus();

    await vi.waitFor(() => {
      expect(useStore.getState().workspaceGitStatusLoading).toBe(false);
    });
    expect(useStore.getState().workspaceGitStatus).toBeNull();
  });

  it("refreshes after reset when the new workspace backend is already ready", async () => {
    const getSessions = vi.spyOn(api, "getSessions").mockResolvedValue({
      sessions: [],
      total: 0,
      hasMore: false,
      nextOffset: null,
    });
    vi.spyOn(api, "getApi").mockReturnValue({} as ReturnType<typeof api.getApi>);
    vi.spyOn(api, "getState").mockRejectedValue(new Error("stop after refresh starts"));
    useStore.setState({
      backendStatus: {
        ready: true,
        starting: false,
        restarting: false,
        retryInMs: 0,
        restartAttempts: 0,
        backendPath: "C:\\pi-backend.exe",
        cwd: "D:\\next",
      },
    });

    useStore.getState().resetForWorkspace("D:\\next");

    expect(useStore.getState().workspaceCwd).toBe("D:\\next");
    await vi.waitFor(() => {
      expect(getSessions).toHaveBeenCalledWith({ all: true, offset: 0, limit: 200, query: "" });
    });
  });

  it("waits for the workspace before the first ready-state session refresh", async () => {
    let resolveWorkspace: ((workspace: { cwd: string; taskCwd: string }) => void) | undefined;
    const getSessions = vi.spyOn(api, "getSessions").mockResolvedValue({
      sessions: [],
      total: 0,
      hasMore: false,
      nextOffset: null,
    });
    vi.spyOn(api, "getApi").mockReturnValue({} as ReturnType<typeof api.getApi>);
    vi.spyOn(api, "getBackendStatus").mockResolvedValue({
      ready: true,
      starting: false,
      restarting: false,
      retryInMs: 0,
      restartAttempts: 0,
      backendPath: "C:\\pi-backend.exe",
      cwd: "D:\\workspace",
    });
    vi.spyOn(api, "getWorkspace").mockImplementation(() => new Promise((resolve) => {
      resolveWorkspace = resolve;
    }));
    vi.spyOn(api, "getWorkspaceGitStatus").mockResolvedValue({
      cwd: "D:\\workspace",
      kind: "not-repository",
      branch: null,
      detached: false,
      dirty: false,
    });

    useStore.setState({
      workspaceCwd: "",
      backendStatus: {
        ready: false,
        starting: false,
        restarting: false,
        retryInMs: 0,
        restartAttempts: 0,
        backendPath: "",
        cwd: "",
      },
    });
    useStore.getState().initialize();

    await vi.waitFor(() => {
      expect(useStore.getState().backendStatus.ready).toBe(true);
    });
    expect(getSessions).not.toHaveBeenCalled();

    resolveWorkspace?.({ cwd: "D:\\workspace", taskCwd: "C:\\pi-studio\\tasks" });
    await vi.waitFor(() => {
      expect(getSessions).toHaveBeenCalledWith({ all: true, offset: 0, limit: 200, query: "" });
      expect(useStore.getState()).toMatchObject({
        workspaceCwd: "D:\\workspace",
        sessionsLoading: false,
      });
    });
  });
});
