import { useEffect } from "react";
import { onEvent, onLog, onStatus } from "./api";
import type { BackendEvent, LogEntry } from "./types";
import { useStore } from "../store";

/**
 * Subscribes to all backend events and dispatches to the Zustand store.
 * Mount once at the app root.
 */
export function useBackendEvents(): void {
  useEffect(() => {
    const unsubEvent = onEvent((raw) => {
      const event = raw as BackendEvent;
      const store = useStore.getState();

      switch (event.type) {
        case "message_start":
        case "message_update":
          store.upsertMessage(event.message, event.type);
          break;
        case "message_end":
          store.upsertMessage(event.message, event.type);
          // Lightweight refresh: message end is high-frequency during a run, so
          // only pull session state + stats, not the full 7-way fan-out.
          store.refreshSession();
          break;
        case "agent_start":
          store.setStreaming(true);
          break;
        case "agent_end":
          store.setStreaming(false);
          // Full refresh at run end: models/commands/sessions may have changed.
          store.refresh();
          break;
        case "tool_execution_start":
          store.setActiveTool(event.toolName ?? null);
          break;
        case "tool_execution_end":
          store.setActiveTool(null);
          break;
        case "queue_update":
          store.refreshSession();
          break;
        case "compaction_start":
        case "compaction_end":
          store.refreshSession();
          break;
        case "extension_ui_request":
          store.addExtensionUIRequest(event);
          break;
      }
    });

    const unsubStatus = onStatus((payload) => {
      useStore.getState().updateBackendStatus({
        ready: Boolean(payload.ready),
        starting: Boolean(payload.starting),
        restarting: Boolean(payload.restarting),
        retryInMs: Number(payload.retryInMs ?? 0),
        restartAttempts: Number(payload.restartAttempts ?? 0),
        backendPath: String(payload.backendPath ?? ""),
        cwd: String(payload.cwd ?? ""),
        error: payload.error ? String(payload.error) : undefined,
      });
    });

    const unsubLog = onLog((entry: LogEntry) => {
      useStore.getState().addLog(entry);
    });

    return () => {
      unsubEvent();
      unsubStatus();
      unsubLog();
    };
  }, []);
}
