import { describe, expect, it } from "vitest";
import {
  filterUnchangedPendingExtensionUIRequests,
  getExtensionUIHydrationGeneration,
  isBackendEventCurrent,
  resolveSessionChangedWorkspaceAction,
  shouldAdvanceBackendConnectionGeneration,
} from "./events";
import type { ExtensionUIRequestEvent } from "./types";

describe("backend event workspace guard", () => {
  it("accepts only events from the current workspace", () => {
    expect(isBackendEventCurrent("C:\\Code\\Pi", "c:/code/pi/")).toBe(true);
    expect(isBackendEventCurrent("C:\\Code\\Other", "C:\\Code\\Pi")).toBe(false);
    expect(isBackendEventCurrent("", "C:\\Code\\Pi")).toBe(false);
    expect(isBackendEventCurrent("C:\\Code\\Pi", "")).toBe(false);
  });
});

describe("session replacement event workspace handling", () => {
  it("refreshes a replacement in the current workspace", () => {
    expect(resolveSessionChangedWorkspaceAction("C:\\Code\\Pi", "c:/code/pi/")).toEqual({ type: "refresh" });
  });

  it("resets when an extension replacement changes cwd", () => {
    expect(resolveSessionChangedWorkspaceAction("C:\\Code\\Pi", "D:\\Other")).toEqual({
      type: "reset",
      cwd: "D:\\Other",
    });
  });

  it("ignores an invalid replacement cwd", () => {
    expect(resolveSessionChangedWorkspaceAction("C:\\Code\\Pi", "  ")).toBeNull();
  });
});

describe("extension UI request hydration readiness", () => {
  it("hydrates once the ready backend and initialized workspace refer to the same cwd", () => {
    expect(getExtensionUIHydrationGeneration(false, "C:\\Code\\Pi", "C:\\Code\\Pi", 3)).toBeNull();
    expect(getExtensionUIHydrationGeneration(true, "C:\\Code\\Pi", "", 3)).toBeNull();
    expect(getExtensionUIHydrationGeneration(true, "C:\\Code\\Other", "C:\\Code\\Pi", 3)).toBeNull();
    expect(getExtensionUIHydrationGeneration(true, "C:\\Code\\Pi", "c:/code/pi/", 3)).toBe(3);
    expect(getExtensionUIHydrationGeneration(true, "C:\\Code\\Pi", "c:/code/pi/", 4)).toBe(4);
  });
});

describe("extension UI request hydration connection scope", () => {
  it("advances when the backend disconnects or a ready backend changes cwd", () => {
    expect(shouldAdvanceBackendConnectionGeneration(false, "C:\\Code\\Pi", "C:\\Code\\Pi")).toBe(true);
    expect(shouldAdvanceBackendConnectionGeneration(true, "C:\\Code\\Pi", "C:\\Code\\Other")).toBe(true);
  });

  it("keeps the generation for an equivalent or not-yet-known cwd", () => {
    expect(shouldAdvanceBackendConnectionGeneration(true, "C:\\Code\\Pi", "c:/code/pi/")).toBe(false);
    expect(shouldAdvanceBackendConnectionGeneration(true, "", "C:\\Code\\Pi")).toBe(false);
    expect(shouldAdvanceBackendConnectionGeneration(true, "C:\\Code\\Pi", "")).toBe(false);
  });
});

describe("extension UI request hydration race guard", () => {
  const request: ExtensionUIRequestEvent = {
    type: "extension_ui_request",
    id: "request-1",
    method: "confirm",
    title: "Confirm",
  };

  it("accepts an untouched snapshot entry", () => {
    expect(filterUnchangedPendingExtensionUIRequests([request], new Map(), new Map())).toEqual([request]);
  });

  it("skips an entry mutated while the snapshot was pending", () => {
    const baseline = new Map([ [request.id, 1] ]);
    const current = new Map([ [request.id, 2] ]);
    expect(filterUnchangedPendingExtensionUIRequests([request], baseline, current)).toEqual([]);
  });

  it("skips an entry removed locally while the snapshot was pending", () => {
    const current = new Map([ [request.id, 1] ]);
    expect(filterUnchangedPendingExtensionUIRequests([request], new Map(), current)).toEqual([]);
  });

  it("keeps unrelated entries when another request changes", () => {
    const other: ExtensionUIRequestEvent = { ...request, id: "request-2" };
    const baseline = new Map([ [request.id, 1], [other.id, 1] ]);
    const current = new Map([ [request.id, 2], [other.id, 1] ]);
    expect(filterUnchangedPendingExtensionUIRequests([request, other], baseline, current)).toEqual([other]);
  });
});
