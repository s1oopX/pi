import { useEffect } from "react";
import { getPendingExtensionUIRequests, onEvent, onLog, onStatus } from "./api";
import { isInteractiveExtensionUIRequest, parseExtensionUIEffect } from "./extensionUIEffects";
import { createExtensionUIRequestTimeoutManager } from "./extensionUIRequestTimeouts";
import type { BackendEvent, ExtensionUIRequestClosedEvent, ExtensionUIRequestEvent, LogEntry } from "./types";
import { useStore } from "../store";
import { showToast } from "../components/Toast";
import { isSameWorkspace } from "../components/Sidebar/sidebarState";
import { t } from "../i18n";

const MAX_EXTENSION_ERROR_DETAIL_LENGTH = 200;

export function describeExtensionError(event: { extensionPath: string; error: string }): {
  extension: string;
  detail: string;
} {
  const extension = event.extensionPath.split(/[\\/]/).pop() || event.extensionPath;
  const error = event.error.trim();
  const detail = error.length > MAX_EXTENSION_ERROR_DETAIL_LENGTH
    ? `${error.slice(0, MAX_EXTENSION_ERROR_DETAIL_LENGTH)}…`
    : error;
  return { extension, detail };
}

export function handleExtensionUIRequestClosed(event: ExtensionUIRequestClosedEvent): void {
  useStore.getState().removeExtensionUIRequest(event.id);
}

export function isBackendEventCurrent(backendCwd: string, workspaceCwd: string): boolean {
  if (!backendCwd || !workspaceCwd) return false;
  return isSameWorkspace(backendCwd, workspaceCwd);
}

export function getExtensionUIHydrationGeneration(
  backendReady: boolean,
  backendCwd: string,
  workspaceCwd: string,
  connectionGeneration: number,
): number | null {
  return backendReady && isBackendEventCurrent(backendCwd, workspaceCwd)
    ? connectionGeneration
    : null;
}

export function shouldAdvanceBackendConnectionGeneration(
  backendReady: boolean,
  previousBackendCwd: string,
  nextBackendCwd: string,
): boolean {
  return !backendReady || (
    previousBackendCwd.length > 0 &&
    nextBackendCwd.length > 0 &&
    !isSameWorkspace(previousBackendCwd, nextBackendCwd)
  );
}

export type SessionChangedWorkspaceAction = { type: "refresh" } | { type: "reset"; cwd: string };

export function resolveSessionChangedWorkspaceAction(
  currentWorkspaceCwd: string,
  nextCwd: string,
): SessionChangedWorkspaceAction | null {
  const cwd = nextCwd.trim();
  if (!cwd) return null;
  return isSameWorkspace(cwd, currentWorkspaceCwd) ? { type: "refresh" } : { type: "reset", cwd };
}

export function filterUnchangedPendingExtensionUIRequests(
  requests: readonly ExtensionUIRequestEvent[],
  baselineVersions: ReadonlyMap<string, number>,
  currentVersions: ReadonlyMap<string, number>,
): ExtensionUIRequestEvent[] {
  return requests.filter(({ id }) => baselineVersions.get(id) === currentVersions.get(id));
}

/**
 * Subscribes to all backend events and dispatches to the Zustand store.
 * Mount once at the app root.
 */
export function useBackendEvents(): void {
  useEffect(() => {
    let disposed = false;
    let backendConnectionGeneration = 0;
    let hydratedConnectionGeneration: number | null = null;
    let hydratingConnectionGeneration: number | null = null;
    let hydrationRetryTimer: ReturnType<typeof setTimeout> | undefined;
    let hydrationRetryGeneration: number | null = null;
    let requestMutationCounter = 0;
    const requestMutationVersions = new Map<string, number>();
    const markRequestMutation = (requestId: string) => {
      if (hydratingConnectionGeneration === null) return;
      requestMutationVersions.set(requestId, ++requestMutationCounter);
    };
    const extensionUIRequestTimeouts = createExtensionUIRequestTimeoutManager((requestId) => {
      useStore.getState().removeExtensionUIRequest(requestId);
    });
    const addPendingExtensionUIRequest = (request: ExtensionUIRequestEvent) => {
      useStore.getState().addExtensionUIRequest(request);
      extensionUIRequestTimeouts.schedule(request);
    };
    const hydratePendingExtensionUIRequests = async (generation: number): Promise<boolean> => {
      requestMutationVersions.clear();
      const baselineVersions = new Map(requestMutationVersions);
      const requests = await getPendingExtensionUIRequests();
      const current = useStore.getState();
      const currentGeneration = getExtensionUIHydrationGeneration(
        current.backendStatus.ready,
        current.backendStatus.cwd,
        current.workspaceCwd,
        backendConnectionGeneration,
      );
      if (disposed || currentGeneration !== generation) return false;
      for (const request of filterUnchangedPendingExtensionUIRequests(
        requests,
        baselineVersions,
        requestMutationVersions,
      )) {
        if (isInteractiveExtensionUIRequest(request)) addPendingExtensionUIRequest(request);
      }
      return true;
    };

    const scheduleHydrationRetry = (generation: number) => {
      if (disposed) return;
      if (hydrationRetryTimer !== undefined) {
        if (hydrationRetryGeneration === generation) return;
        clearTimeout(hydrationRetryTimer);
      }
      hydrationRetryGeneration = generation;
      hydrationRetryTimer = setTimeout(() => {
        hydrationRetryTimer = undefined;
        hydrationRetryGeneration = null;
        const state = useStore.getState();
        const currentGeneration = getExtensionUIHydrationGeneration(
          state.backendStatus.ready,
          state.backendStatus.cwd,
          state.workspaceCwd,
          backendConnectionGeneration,
        );
        if (currentGeneration !== generation) return;
        hydratePendingExtensionUIRequestsWhenReady();
      }, 500);
    };

    function hydratePendingExtensionUIRequestsWhenReady(): void {
      const state = useStore.getState();
      const generation = getExtensionUIHydrationGeneration(
        state.backendStatus.ready,
        state.backendStatus.cwd,
        state.workspaceCwd,
        backendConnectionGeneration,
      );
      if (
        generation === null ||
        generation === hydratedConnectionGeneration ||
        hydratingConnectionGeneration !== null
      ) return;
      hydratingConnectionGeneration = generation;
      void hydratePendingExtensionUIRequests(generation)
        .then((applied) => {
          if (applied && !disposed) hydratedConnectionGeneration = generation;
        })
        .catch(() => {
          const current = useStore.getState();
          const currentGeneration = getExtensionUIHydrationGeneration(
            current.backendStatus.ready,
            current.backendStatus.cwd,
            current.workspaceCwd,
            backendConnectionGeneration,
          );
          if (currentGeneration === generation) scheduleHydrationRetry(generation);
        })
        .finally(() => {
          requestMutationVersions.clear();
          if (hydratingConnectionGeneration === generation) hydratingConnectionGeneration = null;
          const current = useStore.getState();
          const currentGeneration = getExtensionUIHydrationGeneration(
            current.backendStatus.ready,
            current.backendStatus.cwd,
            current.workspaceCwd,
            backendConnectionGeneration,
          );
          if (!disposed && currentGeneration !== null && currentGeneration !== generation) {
            hydratePendingExtensionUIRequestsWhenReady();
          }
        });
    }
    const unsubExtensionUIRequests = useStore.subscribe((state, previousState) => {
      if (state.extensionUIRequests === previousState.extensionUIRequests) return;
      const currentIds = new Set(state.extensionUIRequests.map(({ id }) => id));
      for (const { id } of previousState.extensionUIRequests) {
        if (!currentIds.has(id)) markRequestMutation(id);
      }
      extensionUIRequestTimeouts.syncPendingRequests(state.extensionUIRequests);
    });

    const unsubEvent = onEvent((raw) => {
      const event = raw as BackendEvent;
      const store = useStore.getState();
      if (event.type === "session_changed") {
        const action = resolveSessionChangedWorkspaceAction(store.workspaceCwd, event.cwd);
        if (!store.backendStatus.ready || !action) return;
        if (action.type === "refresh") {
          void store.refreshAsync();
        } else {
          void store.resetForWorkspace(action.cwd);
        }
        return;
      }
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
          // A retryable agent_end is an intermediate recovery boundary. Keep
          // global run guards active until the retry lifecycle reports its end.
          store.setStreaming(event.willRetry);
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
          if (event.type === "compaction_start" || event.type === "auto_retry_start") {
            store.setStreaming(true);
          } else if (
            (event.type === "compaction_end" && !event.willRetry) ||
            (event.type === "auto_retry_end" && !event.success)
          ) {
            store.setStreaming(false);
          }
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
            markRequestMutation(event.id);
            addPendingExtensionUIRequest(event);
          }
          break;
        }
        case "extension_ui_request_closed":
          markRequestMutation(event.id);
          handleExtensionUIRequestClosed(event);
          break;
        case "extension_error": {
          const { extension, detail } = describeExtensionError(event);
          const message = t(
            "Extension error in {extension} ({event}): {detail}",
            "扩展 {extension}（{event}）发生错误：{detail}",
            { extension, event: event.event, detail },
          );
          store.addLog({ level: "error", message });
          showToast(message, "error");
          break;
        }
      }
    });

    const unsubStatus = onStatus((payload) => {
      const store = useStore.getState();
      const ready = Boolean(payload.ready);
      const cwd = String(payload.cwd ?? "");
      if (shouldAdvanceBackendConnectionGeneration(ready, store.backendStatus.cwd, cwd)) {
        backendConnectionGeneration += 1;
      }
      store.updateBackendStatus({
        ready,
        starting: Boolean(payload.starting),
        restarting: Boolean(payload.restarting),
        retryInMs: Number(payload.retryInMs ?? 0),
        restartAttempts: Number(payload.restartAttempts ?? 0),
        backendPath: String(payload.backendPath ?? ""),
        cwd,
        error: payload.error ? String(payload.error) : undefined,
      });
    });

    const unsubLog = onLog((entry: LogEntry) => {
      useStore.getState().addLog(entry);
    });
    const unsubHydration = useStore.subscribe(hydratePendingExtensionUIRequestsWhenReady);
    hydratePendingExtensionUIRequestsWhenReady();

    return () => {
      disposed = true;
      if (hydrationRetryTimer !== undefined) clearTimeout(hydrationRetryTimer);
      hydrationRetryTimer = undefined;
      hydrationRetryGeneration = null;
      unsubEvent();
      unsubStatus();
      unsubLog();
      unsubHydration();
      unsubExtensionUIRequests();
      extensionUIRequestTimeouts.dispose();
    };
  }, []);
}
