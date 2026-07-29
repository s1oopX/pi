import { afterEach, describe, expect, expectTypeOf, it } from "vitest";
import {
  cloneSession,
  followUp,
  forkSession,
  getAuthStatus,
  getMemorySettings,
  getPendingExtensionUIRequests,
  getForkMessages,
  getResources,
  getSessions,
  getSessionTree,
  managePackage,
  newSession,
  sendPrompt,
  resetMemories,
  setMemorySettings,
  steer,
  switchSession,
} from "./api";
import type { BackendCommand, ImageContent, MemorySettings, SessionListPage, SessionTreeData } from "./types";

const image: ImageContent = { type: "image", data: "AQID", mimeType: "image/png" };

afterEach(() => {
  Reflect.deleteProperty(globalThis, "window");
});

describe("image prompt API", () => {
  it("forwards images and streaming behavior with prompt and queue commands", async () => {
    const requests: BackendCommand[] = [];
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        piDesktop: {
          request(command: BackendCommand) {
            requests.push(command);
            return Promise.resolve(null);
          },
        },
      },
    });

    await sendPrompt("Explain", [image]);
    await sendPrompt("/compact", [image], "steer");
    await sendPrompt("More detail", [image], "followUp");
    await steer("Adjust now", [image]);
    await followUp("More detail", [image]);

    expect(requests).toEqual([
      { type: "prompt", message: "Explain", images: [image], streamingBehavior: undefined },
      { type: "prompt", message: "/compact", images: [image], streamingBehavior: "steer" },
      { type: "prompt", message: "More detail", images: [image], streamingBehavior: "followUp" },
      { type: "steer", message: "Adjust now", images: [image] },
      { type: "follow_up", message: "More detail", images: [image] },
    ]);
  });
});

describe("extension UI request hydration API", () => {
  it("returns the main-process pending request snapshot", async () => {
    const pending = [{ type: "extension_ui_request", id: "request-1", method: "confirm" }];
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        piDesktop: {
          getPendingExtensionUIRequests() {
            return Promise.resolve(pending);
          },
        },
      },
    });

    await expect(getPendingExtensionUIRequests()).resolves.toEqual(pending);
  });

  it("treats an older preload without the hydration bridge as empty", async () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { piDesktop: {} },
    });

    await expect(getPendingExtensionUIRequests()).resolves.toEqual([]);
  });
});

describe("session list API", () => {
  it("forwards pagination and search options and returns page metadata", async () => {
    const requests: BackendCommand[] = [];
    const page: SessionListPage = {
      sessions: [],
      total: 53,
      hasMore: true,
      nextOffset: 40,
    };
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        piDesktop: {
          request(command: BackendCommand) {
            requests.push(command);
            return Promise.resolve(page);
          },
        },
      },
    });

    await expect(getSessions({ offset: 20, limit: 20, query: "workspace", all: false })).resolves.toEqual(page);
    expect(requests).toEqual([
      { type: "get_sessions", offset: 20, limit: 20, query: "workspace", all: false },
    ]);
  });

  it("requests fork candidates and the branch tree", async () => {
    const requests: BackendCommand[] = [];
    const tree: SessionTreeData = { tree: [], leafId: null };
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        piDesktop: {
          request(command: BackendCommand) {
            requests.push(command);
            return Promise.resolve(command.type === "get_tree"
              ? tree
              : { messages: [{ entryId: "entry-1", text: "Start here" }] });
          },
        },
      },
    });

    await expect(getForkMessages()).resolves.toEqual([{ entryId: "entry-1", text: "Start here" }]);
    await expect(getSessionTree()).resolves.toEqual(tree);
    expect(requests).toEqual([{ type: "get_fork_messages" }, { type: "get_tree" }]);
  });

  it("returns clone and fork cancellation results", async () => {
    const requests: BackendCommand[] = [];
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        piDesktop: {
          request(command: BackendCommand) {
            requests.push(command);
            return Promise.resolve(command.type === "clone"
              ? { cancelled: true }
              : command.type === "fork" && command.entryId === "cancelled"
                ? { cancelled: true }
                : { text: "Fork point", cancelled: false });
          },
        },
      },
    });

    await expect(cloneSession()).resolves.toEqual({ cancelled: true });
    const cancelled = await forkSession("cancelled");
    expect(cancelled).toEqual({ cancelled: true });
    if (cancelled.cancelled) expectTypeOf(cancelled.text).toEqualTypeOf<undefined>();
    const forked = await forkSession("entry-1");
    expect(forked).toEqual({ text: "Fork point", cancelled: false });
    if (!forked.cancelled) expectTypeOf(forked.text).toEqualTypeOf<string>();
    expect(requests).toEqual([
      { type: "clone" },
      { type: "fork", entryId: "cancelled" },
      { type: "fork", entryId: "entry-1" },
    ]);
  });

  it("returns new and switch session cancellation results", async () => {
    const requests: BackendCommand[] = [];
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        piDesktop: {
          request(command: BackendCommand) {
            requests.push(command);
            return Promise.resolve({ cancelled: command.type === "new_session" });
          },
        },
      },
    });

    await expect(newSession()).resolves.toEqual({ cancelled: true });
    await expect(switchSession("thread.jsonl")).resolves.toEqual({ cancelled: false });
    expect(requests).toEqual([
      { type: "new_session" },
      { type: "switch_session", sessionPath: "thread.jsonl" },
    ]);
  });
});

describe("settings metadata API", () => {
  it("requests the complete auth status and forwards resource reloads", async () => {
    const requests: BackendCommand[] = [];
    const authStatuses = { custom: { configured: true, source: "stored" as const } };
    const resources = { extensions: [], skills: [], prompts: [] };
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        piDesktop: {
          request(command: BackendCommand) {
            requests.push(command);
            return Promise.resolve(command.type === "get_auth_status"
              ? { providers: authStatuses }
              : resources);
          },
        },
      },
    });

    await expect(getAuthStatus()).resolves.toEqual(authStatuses);
    await expect(getResources({ reload: true })).resolves.toEqual(resources);
    await managePackage("install", "npm:@example/tools", true);
    expect(requests).toEqual([
      { type: "get_auth_status" },
      { type: "get_resources", reload: true },
      { type: "manage_package", action: "install", source: "npm:@example/tools", local: true },
    ]);
  });

  it("forwards memory settings and reset commands", async () => {
    const requests: BackendCommand[] = [];
    const settings: MemorySettings = {
      enabled: true,
      allowToolChats: false,
      useMemories: true,
      generateMemories: true,
      useMemoriesLocked: false,
      count: 2,
      path: "C:/memories.json",
    };
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        piDesktop: {
          request(command: BackendCommand) {
            requests.push(command);
            return Promise.resolve(command.type === "reset_memories" ? { count: 0, path: settings.path } : settings);
          },
        },
      },
    });

    await expect(getMemorySettings()).resolves.toEqual(settings);
    await expect(setMemorySettings({ enabled: false, useMemories: false })).resolves.toEqual(settings);
    await expect(resetMemories()).resolves.toEqual({ count: 0, path: settings.path });
    expect(requests).toEqual([
      { type: "get_memory_settings" },
      { type: "set_memory_settings", enabled: false, useMemories: false },
      { type: "reset_memories" },
    ]);
  });
});
