import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthStatus, BackendCommand, WorkspaceGitStatus } from "../ipc/types";
import { useStore } from ".";

beforeEach(() => {
  useStore.setState({
    workspaceCwd: "C:\\repo",
    authStatuses: {},
    models: [],
    customModelsConfig: null,
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

describe("provider auth visibility", () => {
  it("refreshes the complete backend status when no available model references a stored provider", async () => {
    const requests: BackendCommand[] = [];
    const authStatuses: Record<string, AuthStatus> = {
      "stored-only": { configured: true, source: "stored" },
    };
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        piDesktop: {
          request(command: BackendCommand): Promise<unknown> {
            requests.push(command);
            if (command.type === "get_messages") return Promise.resolve({ messages: [] });
            if (command.type === "get_available_models") return Promise.resolve({ models: [] });
            if (command.type === "get_custom_models") {
              return Promise.resolve({ path: "C:\\config\\models.json", providers: {} });
            }
            if (command.type === "get_commands") return Promise.resolve({ commands: [] });
            if (command.type === "get_auth_status") return Promise.resolve({ providers: authStatuses });
            if (command.type === "get_sessions") {
              return Promise.resolve({ sessions: [], total: 0, hasMore: false, nextOffset: null });
            }
            return Promise.resolve(null);
          },
          getWorkspaceGitStatus(): Promise<WorkspaceGitStatus> {
            return Promise.resolve({
              cwd: "C:\\repo",
              kind: "not-repository",
              branch: null,
              detached: false,
              dirty: false,
            });
          },
        },
      },
    });

    useStore.getState().refresh();

    await vi.waitFor(() => expect(useStore.getState().authStatuses).toEqual(authStatuses));
    expect(requests.filter((command) => command.type === "get_auth_status")).toEqual([
      { type: "get_auth_status" },
    ]);
  });
});
