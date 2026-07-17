import { isInteractiveExtensionUIRequest } from "./extensionUIEffects";
import type { ExtensionUIRequestEvent } from "./types";

const MAX_TIMER_DELAY_MS = 2_147_483_647;

function getRequestTimeoutMs(request: ExtensionUIRequestEvent): number | null {
  const timeout = request.timeout;
  if (
    !isInteractiveExtensionUIRequest(request) ||
    typeof timeout !== "number" ||
    !Number.isSafeInteger(timeout) ||
    timeout <= 0 ||
    timeout > MAX_TIMER_DELAY_MS
  ) {
    return null;
  }
  return timeout;
}

export interface ExtensionUIRequestTimeoutManager {
  schedule: (request: ExtensionUIRequestEvent) => void;
  syncPendingRequests: (requests: readonly ExtensionUIRequestEvent[]) => void;
  dispose: () => void;
}

export function createExtensionUIRequestTimeoutManager(
  onTimeout: (requestId: string) => void,
): ExtensionUIRequestTimeoutManager {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const cancel = (requestId: string) => {
    const timer = timers.get(requestId);
    if (timer === undefined) return;
    clearTimeout(timer);
    timers.delete(requestId);
  };

  return {
    schedule(request) {
      cancel(request.id);
      const timeoutMs = getRequestTimeoutMs(request);
      if (timeoutMs === null) return;
      const timer = setTimeout(() => {
        timers.delete(request.id);
        onTimeout(request.id);
      }, timeoutMs);
      timers.set(request.id, timer);
    },

    syncPendingRequests(requests) {
      const pendingIds = new Set(requests.map((request) => request.id));
      for (const requestId of timers.keys()) {
        if (!pendingIds.has(requestId)) cancel(requestId);
      }
    },

    dispose() {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    },
  };
}
