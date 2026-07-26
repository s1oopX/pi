import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../ipc/api";
import type { Message, Model, SessionInfo, SessionState, SessionStats } from "../ipc/types";
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

function sessionState(sessionId: string): SessionState {
  return {
    thinkingLevel: "off",
    isStreaming: false,
    isCompacting: false,
    steeringMode: "one-at-a-time",
    followUpMode: "one-at-a-time",
    cwd: "C:\\initial",
    sessionFile: `C:\\sessions\\${sessionId}.jsonl`,
    sessionId,
    autoCompactionEnabled: true,
    autoRetryEnabled: true,
    isRetrying: false,
    retryAttempt: 0,
    messageCount: 0,
    pendingMessageCount: 0,
    projectTrusted: true,
    projectTrustRequired: false,
  };
}

function sessionStats(sessionId: string): SessionStats {
  return {
    sessionFile: `C:\\sessions\\${sessionId}.jsonl`,
    sessionId,
    userMessages: 0,
    assistantMessages: 0,
    toolCalls: 0,
    toolResults: 0,
    totalMessages: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
  };
}

function assistantMessage(text: string): Message {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "anthropic-messages",
    provider: "anthropic",
    model: "claude",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: 1,
  };
}

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
      workspaceLoading: true,
    });
  });

  it("holds workspaceLoading until a terminal offline status arrives", () => {
    useStore.getState().resetForWorkspace("D:\\next");
    expect(useStore.getState().workspaceLoading).toBe(true);

    // Still starting: keep the loading surface up.
    useStore.getState().updateBackendStatus({
      ready: false,
      starting: true,
      restarting: false,
      retryInMs: 0,
      restartAttempts: 0,
      backendPath: "",
      cwd: "",
    });
    expect(useStore.getState().workspaceLoading).toBe(true);

    // Terminal offline (no starting/restarting/retry): release the surface so
    // the empty state can offer a retry action.
    useStore.getState().updateBackendStatus({
      ready: false,
      starting: false,
      restarting: false,
      retryInMs: 0,
      restartAttempts: 3,
      backendPath: "",
      cwd: "",
    });
    expect(useStore.getState().workspaceLoading).toBe(false);
  });

  it("clears the active run when the backend disconnects", () => {
    useStore.setState({ isStreaming: true, activeMessageIndex: 2 });

    useStore.getState().updateBackendStatus({
      ready: false,
      starting: true,
      restarting: true,
      retryInMs: 1000,
      restartAttempts: 1,
      backendPath: "C:\\pi-backend.exe",
      cwd: "C:\\initial",
    });

    expect(useStore.getState()).toMatchObject({ isStreaming: false, activeMessageIndex: null });
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

  it("keeps workspaceLoading when refresh cannot run while the backend is still starting", async () => {
    vi.spyOn(api, "getApi").mockReturnValue(undefined);
    useStore.setState({
      workspaceCwd: "D:\\next",
      workspaceLoading: true,
      backendStatus: {
        ready: false,
        starting: true,
        restarting: false,
        retryInMs: 0,
        restartAttempts: 0,
        backendPath: "",
        cwd: "D:\\next",
      },
    });

    await useStore.getState().refreshAsync();

    expect(useStore.getState().workspaceLoading).toBe(true);
  });

  it("releases workspaceLoading when a ready backend refresh fails for the current workspace", async () => {
    vi.spyOn(api, "getApi").mockReturnValue({} as ReturnType<typeof api.getApi>);
    vi.spyOn(api, "getSessions").mockResolvedValue({
      sessions: [],
      total: 0,
      hasMore: false,
      nextOffset: null,
    });
    vi.spyOn(api, "getState").mockRejectedValue(new Error("refresh failed"));
    vi.spyOn(api, "getMessages").mockResolvedValue([]);
    vi.spyOn(api, "getAvailableModels").mockResolvedValue([]);
    vi.spyOn(api, "getCustomModels").mockRejectedValue(new Error("unavailable"));
    vi.spyOn(api, "getSessionStats").mockResolvedValue(undefined);
    vi.spyOn(api, "getCommands").mockResolvedValue([]);
    useStore.setState({
      workspaceCwd: "D:\\next",
      workspaceLoading: true,
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

    await useStore.getState().refreshAsync();

    expect(useStore.getState().workspaceLoading).toBe(false);
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

  it("does not let an older full refresh overwrite a newer session refresh", async () => {
    let resolveOldModels: ((models: Model[]) => void) | undefined;
    const oldModels = new Promise<Model[]>((resolve) => {
      resolveOldModels = resolve;
    });
    const catalogModels: Model[] = [{
      id: "catalog-model",
      name: "Catalog model",
      api: "openai-completions",
      provider: "test",
      baseUrl: "https://example.test",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 1024,
      maxTokens: 256,
    }];
    const oldSession = sessionState("old-session");
    const newSession = sessionState("new-session");
    const newStats = sessionStats("new-session");

    vi.spyOn(api, "getApi").mockReturnValue({} as ReturnType<typeof api.getApi>);
    vi.spyOn(api, "getSessions").mockResolvedValue({
      sessions: [],
      total: 0,
      hasMore: false,
      nextOffset: null,
    });
    vi.spyOn(api, "getState").mockResolvedValueOnce(oldSession).mockResolvedValueOnce(newSession);
    vi.spyOn(api, "getMessages").mockResolvedValue([]);
    vi.spyOn(api, "getAvailableModels").mockReturnValueOnce(oldModels);
    vi.spyOn(api, "getCustomModels").mockResolvedValue({ path: "", providers: {} });
    vi.spyOn(api, "getSessionStats")
      .mockResolvedValueOnce(sessionStats("old-session"))
      .mockResolvedValueOnce(newStats);
    vi.spyOn(api, "getCommands").mockResolvedValue([]);
    vi.spyOn(api, "getAuthStatus").mockResolvedValue({});
    vi.spyOn(api, "getWorkspaceGitStatus").mockResolvedValue({
      cwd: "C:\\initial",
      kind: "not-repository",
      branch: null,
      detached: false,
      dirty: false,
    });
    useStore.setState({
      workspaceCwd: "C:\\initial",
      workspaceLoading: true,
      session: null,
      stats: undefined,
      backendStatus: {
        ready: true,
        starting: false,
        restarting: false,
        retryInMs: 0,
        restartAttempts: 0,
        backendPath: "C:\\pi-backend.exe",
        cwd: "C:\\initial",
      },
    });

    const fullRefresh = useStore.getState().refreshAsync();
    useStore.getState().refreshSession();

    await vi.waitFor(() => {
      expect(useStore.getState().session?.sessionId).toBe("new-session");
    });
    expect(useStore.getState().workspaceLoading).toBe(true);
    resolveOldModels?.(catalogModels);
    await fullRefresh;

    expect(useStore.getState().session?.sessionId).toBe("new-session");
    expect(useStore.getState().stats).toEqual(newStats);
    expect(useStore.getState().models).toEqual(catalogModels);
    expect(useStore.getState().workspaceLoading).toBe(false);
  });

  it("does not apply an in-flight refresh after the backend disconnects", async () => {
    let resolveModels: ((models: Model[]) => void) | undefined;
    const modelsPromise = new Promise<Model[]>((resolve) => {
      resolveModels = resolve;
    });
    const staleSession = sessionState("stale-session");

    vi.spyOn(api, "getApi").mockReturnValue({} as ReturnType<typeof api.getApi>);
    vi.spyOn(api, "getSessions").mockResolvedValue({
      sessions: [],
      total: 0,
      hasMore: false,
      nextOffset: null,
    });
    vi.spyOn(api, "getState").mockResolvedValue(staleSession);
    vi.spyOn(api, "getMessages").mockResolvedValue([]);
    vi.spyOn(api, "getAvailableModels").mockReturnValue(modelsPromise);
    vi.spyOn(api, "getCustomModels").mockResolvedValue({ path: "", providers: {} });
    vi.spyOn(api, "getSessionStats").mockResolvedValue(sessionStats("stale-session"));
    vi.spyOn(api, "getCommands").mockResolvedValue([]);
    vi.spyOn(api, "getAuthStatus").mockResolvedValue({});
    vi.spyOn(api, "getWorkspaceGitStatus").mockResolvedValue({
      cwd: "C:\\initial",
      kind: "not-repository",
      branch: null,
      detached: false,
      dirty: false,
    });
    useStore.setState({
      workspaceCwd: "C:\\initial",
      workspaceLoading: true,
      session: null,
      stats: undefined,
      backendStatus: {
        ready: true,
        starting: false,
        restarting: false,
        retryInMs: 0,
        restartAttempts: 0,
        backendPath: "C:\\pi-backend.exe",
        cwd: "C:\\initial",
      },
    });

    const refresh = useStore.getState().refreshAsync();
    useStore.getState().updateBackendStatus({
      ready: false,
      starting: false,
      restarting: false,
      retryInMs: 0,
      restartAttempts: 1,
      backendPath: "C:\\pi-backend.exe",
      cwd: "C:\\initial",
    });
    resolveModels?.([]);
    await refresh;

    expect(useStore.getState().session).toBeNull();
    expect(useStore.getState().stats).toBeUndefined();
    expect(useStore.getState().isStreaming).toBe(false);
    expect(useStore.getState().workspaceLoading).toBe(false);
  });

  it("falls back to an older full refresh when a newer full refresh fails", async () => {
    let resolveOldModels: ((models: Model[]) => void) | undefined;
    const oldModels = new Promise<Model[]>((resolve) => {
      resolveOldModels = resolve;
    });
    const oldSession = sessionState("old-full-session");
    let stateCalls = 0;

    vi.spyOn(api, "getApi").mockReturnValue({} as ReturnType<typeof api.getApi>);
    vi.spyOn(api, "getSessions").mockResolvedValue({
      sessions: [],
      total: 0,
      hasMore: false,
      nextOffset: null,
    });
    vi.spyOn(api, "getState").mockImplementation(() => {
      stateCalls += 1;
      return stateCalls === 1 ? Promise.resolve(oldSession) : Promise.reject(new Error("new refresh failed"));
    });
    vi.spyOn(api, "getMessages").mockResolvedValue([]);
    vi.spyOn(api, "getAvailableModels").mockReturnValueOnce(oldModels).mockResolvedValue([]);
    vi.spyOn(api, "getCustomModels").mockResolvedValue({ path: "", providers: {} });
    vi.spyOn(api, "getSessionStats").mockResolvedValue(sessionStats("old-full-session"));
    vi.spyOn(api, "getCommands").mockResolvedValue([]);
    vi.spyOn(api, "getAuthStatus").mockResolvedValue({});
    vi.spyOn(api, "getWorkspaceGitStatus").mockResolvedValue({
      cwd: "C:\\initial",
      kind: "not-repository",
      branch: null,
      detached: false,
      dirty: false,
    });
    useStore.setState({
      workspaceCwd: "C:\\initial",
      workspaceLoading: true,
      session: null,
      stats: undefined,
      backendStatus: {
        ready: true,
        starting: false,
        restarting: false,
        retryInMs: 0,
        restartAttempts: 0,
        backendPath: "C:\\pi-backend.exe",
        cwd: "C:\\initial",
      },
    });

    const oldRefresh = useStore.getState().refreshAsync();
    const newRefresh = useStore.getState().refreshAsync();
    await newRefresh;
    expect(useStore.getState().workspaceLoading).toBe(true);

    resolveOldModels?.([]);
    await oldRefresh;

    expect(useStore.getState().session?.sessionId).toBe("old-full-session");
    expect(useStore.getState().workspaceLoading).toBe(false);
  });

  it("does not let an older full refresh cross a session reset", async () => {
    let resolveOldModels: ((models: Model[]) => void) | undefined;
    const oldModels = new Promise<Model[]>((resolve) => {
      resolveOldModels = resolve;
    });
    const oldSession = sessionState("old-session");
    let stateCalls = 0;

    vi.spyOn(api, "getApi").mockReturnValue({} as ReturnType<typeof api.getApi>);
    vi.spyOn(api, "getSessions").mockResolvedValue({
      sessions: [],
      total: 0,
      hasMore: false,
      nextOffset: null,
    });
    vi.spyOn(api, "getState").mockImplementation(() => {
      stateCalls += 1;
      return stateCalls === 1 ? Promise.resolve(oldSession) : Promise.reject(new Error("new refresh failed"));
    });
    vi.spyOn(api, "getMessages").mockResolvedValue([]);
    vi.spyOn(api, "getAvailableModels").mockReturnValueOnce(oldModels).mockResolvedValue([]);
    vi.spyOn(api, "getCustomModels").mockResolvedValue({ path: "", providers: {} });
    vi.spyOn(api, "getSessionStats").mockResolvedValue(sessionStats("old-session"));
    vi.spyOn(api, "getCommands").mockResolvedValue([]);
    vi.spyOn(api, "getAuthStatus").mockResolvedValue({});
    vi.spyOn(api, "getWorkspaceGitStatus").mockResolvedValue({
      cwd: "C:\\initial",
      kind: "not-repository",
      branch: null,
      detached: false,
      dirty: false,
    });
    useStore.setState({
      workspaceCwd: "C:\\initial",
      workspaceLoading: true,
      session: null,
      messages: [],
      stats: undefined,
      backendStatus: {
        ready: true,
        starting: false,
        restarting: false,
        retryInMs: 0,
        restartAttempts: 0,
        backendPath: "C:\\pi-backend.exe",
        cwd: "C:\\initial",
      },
    });

    const oldRefresh = useStore.getState().refreshAsync();
    useStore.getState().resetForWorkspace("C:\\initial");

    await vi.waitFor(() => {
      expect(useStore.getState().workspaceLoading).toBe(false);
    });
    resolveOldModels?.([]);
    await oldRefresh;

    expect(useStore.getState().session).toBeNull();
    expect(useStore.getState().messages).toEqual([]);
    expect(useStore.getState().stats).toBeUndefined();
  });

  it("does not let an older full refresh replace a finalized message after a light refresh fails", async () => {
    let resolveModels: ((models: Model[]) => void) | undefined;
    const modelsPromise = new Promise<Model[]>((resolve) => {
      resolveModels = resolve;
    });
    const partial = assistantMessage("partial");
    const finalized = assistantMessage("finalized");
    const currentSession = sessionState("current-session");

    vi.spyOn(api, "getApi").mockReturnValue({} as ReturnType<typeof api.getApi>);
    vi.spyOn(api, "getSessions").mockResolvedValue({
      sessions: [],
      total: 0,
      hasMore: false,
      nextOffset: null,
    });
    vi.spyOn(api, "getState").mockResolvedValue(currentSession);
    const getMessages = vi.spyOn(api, "getMessages")
      .mockResolvedValueOnce([partial])
      .mockRejectedValueOnce(new Error("light refresh failed"));
    vi.spyOn(api, "getAvailableModels").mockReturnValue(modelsPromise);
    vi.spyOn(api, "getCustomModels").mockResolvedValue({ path: "", providers: {} });
    vi.spyOn(api, "getSessionStats").mockResolvedValue(sessionStats("current-session"));
    vi.spyOn(api, "getCommands").mockResolvedValue([]);
    vi.spyOn(api, "getAuthStatus").mockResolvedValue({});
    vi.spyOn(api, "getWorkspaceGitStatus").mockResolvedValue({
      cwd: "C:\\initial",
      kind: "not-repository",
      branch: null,
      detached: false,
      dirty: false,
    });
    useStore.setState({
      workspaceCwd: "C:\\initial",
      workspaceLoading: false,
      session: currentSession,
      messages: [],
      stats: sessionStats("current-session"),
      isStreaming: true,
      activeMessageIndex: null,
      backendStatus: {
        ready: true,
        starting: false,
        restarting: false,
        retryInMs: 0,
        restartAttempts: 0,
        backendPath: "C:\\pi-backend.exe",
        cwd: "C:\\initial",
      },
    });

    const fullRefresh = useStore.getState().refreshAsync();
    useStore.getState().upsertMessage(partial, "message_start");
    useStore.getState().upsertMessage(finalized, "message_end");
    useStore.getState().refreshSession();

    await vi.waitFor(() => {
      expect(getMessages).toHaveBeenCalledTimes(2);
    });
    resolveModels?.([]);
    await fullRefresh;

    expect(useStore.getState().messages).toEqual([finalized]);
    expect(useStore.getState().activeMessageIndex).toBeNull();
  });
});
