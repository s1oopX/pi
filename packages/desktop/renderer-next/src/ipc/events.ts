import { useEffect } from "react";
import { onEvent, onLog, onStatus } from "./api";
import { isInteractiveExtensionUIRequest, parseExtensionUIEffect } from "./extensionUIEffects";
import { createExtensionUIRequestTimeoutManager } from "./extensionUIRequestTimeouts";
import type { BackendEvent, ExtensionUIRequestClosedEvent, LogEntry } from "./types";
import { useStore } from "../store";
import { showToast } from "../components/Toast";
import { isSameWorkspace } from "../components/Sidebar/sidebarState";

export function handleExtensionUIRequestClosed(event: ExtensionUIRequestClosedEvent): void {
  useStore.getState().removeExtensionUIRequest(event.id);
}

export function isBackendEventCurrent(backendCwd: string, workspaceCwd: string): boolean {
  if (!backendCwd || !workspaceCwd) return false;
  return isSameWorkspace(backendCwd, workspaceCwd);
}

/**
 * Subscribes to all backend events and dispatches to the Zustand store.
 * Mount once at the app root.
 */
export function useBackendEvents(): void {
  useEffect(() => {
    const extensionUIRequestTimeouts = createExtensionUIRequestTimeoutManager((requestId) => {
      useStore.getState().removeExtensionUIRequest(requestId);
    });
    const unsubExtensionUIRequests = useStore.subscribe((state, previousState) => {
      if (state.extensionUIRequests === previousState.extensionUIRequests) return;
      extensionUIRequestTimeouts.syncPendingRequests(state.extensionUIRequests);
    });

    const unsubEvent = onEvent((raw) => {
      const event = raw as BackendEvent;
      const store = useStore.getState();
      if (!isBackendEventCurrent(store.backendStatus.cwd, store.workspaceCwd)) return;

      switch (event.type) {
        case "message_start":
        case "message_update":
        case "message_end":
          if (event.message.role === "assistant") {
            store.queueToolExecutions(
              event.message.content
                .filter((block) => block.type === "toolCall")
                .map((block) => ({ callId: block.id, toolName: block.name })),
            );
          }
          store.upsertMessage(event.message, event.type);
          if (event.type === "message_end") {
            // Lightweight refresh: message end is high-frequency during a run, so
            // only pull session state + stats, not the full 7-way fan-out.
            store.refreshSession();
          }
          break;
        case "agent_start":
          store.clearToolExecutions();
          useStore.setState({ activeMessageIndex: null });
          store.setStreaming(true);
          break;
        case "agent_end":
          store.setStreaming(false);
          // Full refresh at run end: models/commands/sessions may have changed.
          store.refresh();
          break;
        case "tool_execution_start":
          store.startToolExecution(event.toolCallId, event.toolName);
          break;
        case "tool_execution_end":
          store.finishToolExecution(event.toolCallId, event.toolName, event.isError);
          break;
        case "queue_update":
          useStore.setState({
            queuedSteering: [...event.steering],
            queuedFollowUp: [...event.followUp],
          });
          break;
        case "compaction_start":
        case "compaction_end":
        case "auto_retry_start":
        case "auto_retry_end":
          store.updateAgentActivity(event);
          store.refreshSession();
          break;
        case "extension_ui_request": {
          const effect = parseExtensionUIEffect(event);
          if (effect?.kind === "notify") {
            showToast(effect.message, effect.notificationType);
          } else if (effect?.kind === "status") {
            store.setExtensionStatus(effect.key, effect.text);
          } else if (effect?.kind === "widget") {
            store.setExtensionWidget(effect.key, effect.lines, effect.placement);
          } else if (effect?.kind === "title") {
            store.setExtensionTitle(effect.title);
          } else if (effect?.kind === "editorText") {
            store.setComposerDraft(effect.text);
          } else if (isInteractiveExtensionUIRequest(event)) {
            store.addExtensionUIRequest(event);
            extensionUIRequestTimeouts.schedule(event);
          }
          break;
        }
        case "extension_ui_request_closed":
          handleExtensionUIRequestClosed(event);
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
      unsubExtensionUIRequests();
      extensionUIRequestTimeouts.dispose();
    };
  }, []);
}
