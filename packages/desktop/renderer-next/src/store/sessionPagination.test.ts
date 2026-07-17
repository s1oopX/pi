import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BackendCommand, SessionInfo, SessionListPage, WorkspaceGitStatus } from "../ipc/types";
import { useStore } from ".";

function session(id: string): SessionInfo {
  return {
    id,
    path: `C:\\sessions\\${id}.jsonl`,
    cwd: "C:\\repo",
    created: "2026-07-15T00:00:00.000Z",
    modified: "2026-07-15T00:00:00.000Z",
    messageCount: 1,
    firstMessage: id,
    allMessagesText: id,
  };
}

function installDesktopApi(request: (command: BackendCommand) => Promise<unknown>): void {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      piDesktop: {
        request,
        getWorkspaceGitStatus(): Promise<WorkspaceGitStatus> {
          const cwd = useStore.getState().workspaceCwd;
          return Promise.resolve({ cwd, kind: "not-repository", branch: null, detached: false, dirty: false });
        },
      },
    },
  });
}

beforeEach(() => {
  useStore.setState({
    workspaceCwd: "C:\\repo",
    sessions: [],
    sessionsTotal: 0,
    sessionsHasMore: false,
    sessionsNextOffset: null,
    sessionsQuery: "",
    sessionsLoading: false,
    sessionsError: null,
  });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "window");
});

describe("session pagination store", () => {
  it("replaces search results and appends the next page without duplicates", async () => {
    const first = session("first");
    const second = session("second");
    const requests: BackendCommand[] = [];
    installDesktopApi((command) => {
      requests.push(command);
      const page: SessionListPage = command.type === "get_sessions" && command.offset === 1
        ? { sessions: [first, second], total: 2, hasMore: false, nextOffset: null }
        : { sessions: [first], total: 2, hasMore: true, nextOffset: 1 };
      return Promise.resolve(page);
    });

    await useStore.getState().setSessionsQuery("  workspace  ");
    expect(useStore.getState()).toMatchObject({
      sessions: [first],
      sessionsTotal: 2,
      sessionsHasMore: true,
      sessionsNextOffset: 1,
      sessionsQuery: "workspace",
      sessionsLoading: false,
    });

    await useStore.getState().loadMoreSessions();
    expect(useStore.getState()).toMatchObject({
      sessions: [first, second],
      sessionsTotal: 2,
      sessionsHasMore: false,
      sessionsNextOffset: null,
      sessionsLoading: false,
    });
    expect(requests).toEqual([
      { type: "get_sessions", all: true, offset: 0, limit: 200, query: "workspace" },
      { type: "get_sessions", all: true, offset: 1, limit: 200, query: "workspace" },
    ]);
  });

  it("preserves a global page that resolves after switching workspaces", async () => {
    let resolvePage: ((page: SessionListPage) => void) | undefined;
    installDesktopApi(() => new Promise<SessionListPage>((resolve) => {
      resolvePage = resolve;
    }));

    const pending = useStore.getState().setSessionsQuery("old workspace");
    useStore.getState().resetForWorkspace("D:\\next");
    resolvePage?.({ sessions: [session("stale")], total: 1, hasMore: false, nextOffset: null });
    await pending;

    expect(useStore.getState()).toMatchObject({
      workspaceCwd: "D:\\next",
      sessions: [session("stale")],
      sessionsTotal: 1,
      sessionsHasMore: false,
      sessionsNextOffset: null,
      sessionsQuery: "old workspace",
      sessionsLoading: false,
      sessionsError: null,
    });
  });

  it("preserves existing threads on failure and clears the error after retry", async () => {
    const existing = session("existing");
    let fail = true;
    installDesktopApi(() => fail
      ? Promise.reject(new Error("Session index unavailable"))
      : Promise.resolve({ sessions: [existing], total: 1, hasMore: false, nextOffset: null }));
    useStore.setState({ sessions: [existing], sessionsTotal: 1 });

    await useStore.getState().refreshSessions();
    expect(useStore.getState()).toMatchObject({
      sessions: [existing],
      sessionsTotal: 1,
      sessionsLoading: false,
      sessionsError: "Session index unavailable",
    });

    fail = false;
    await useStore.getState().refreshSessions();
    expect(useStore.getState()).toMatchObject({
      sessions: [existing],
      sessionsLoading: false,
      sessionsError: null,
    });
  });
});
