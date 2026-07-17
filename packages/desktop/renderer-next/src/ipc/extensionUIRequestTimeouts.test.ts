import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionUIRequestEvent } from "./types";
import { createExtensionUIRequestTimeoutManager } from "./extensionUIRequestTimeouts";

function request(
  id: string,
  method: string,
  timeout?: unknown,
): ExtensionUIRequestEvent {
  return { type: "extension_ui_request", id, method, timeout };
}

describe("extension UI request timeout manager", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("expires interactive requests after their declared timeout", () => {
    const expired: string[] = [];
    const manager = createExtensionUIRequestTimeoutManager((id) => expired.push(id));
    manager.schedule(request("confirm-1", "confirm", 250));

    vi.advanceTimersByTime(249);
    expect(expired).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(expired).toEqual(["confirm-1"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores non-interactive, fractional, non-positive, and overflowing timeouts", () => {
    const manager = createExtensionUIRequestTimeoutManager(() => {});
    manager.schedule(request("notify", "notify", 100));
    manager.schedule(request("missing", "input"));
    manager.schedule(request("zero", "select", 0));
    manager.schedule(request("negative", "confirm", -1));
    manager.schedule(request("fractional", "input", 1.5));
    manager.schedule(request("infinite", "editor", Number.POSITIVE_INFINITY));
    manager.schedule(request("overflow", "confirm", 2_147_483_648));
    manager.schedule(request("string", "select", "100"));

    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels timers when requests leave the store and when disposed", () => {
    const expired: string[] = [];
    const manager = createExtensionUIRequestTimeoutManager((id) => expired.push(id));
    const first = request("first", "confirm", 100);
    const second = request("second", "input", 100);
    manager.schedule(first);
    manager.schedule(second);

    manager.syncPendingRequests([second]);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(100);
    expect(expired).toEqual(["second"]);

    manager.schedule(request("third", "select", 100));
    manager.dispose();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(100);
    expect(expired).toEqual(["second"]);
  });
});
