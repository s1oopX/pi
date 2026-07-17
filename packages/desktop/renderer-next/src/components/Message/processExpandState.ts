export type ProcessExpandPolicy = "thinking" | "tool" | "file-row";

export interface ProcessExpandState {
  open: boolean;
  userLocked: boolean;
}

export type ProcessExpandEvent =
  | { type: "stream-start" }
  | { type: "stream-end" }
  | { type: "phase-error" }
  | { type: "user-toggle" }
  | { type: "set-default"; open: boolean };

export function createProcessExpandState(initialOpen = false): ProcessExpandState {
  return { open: initialOpen, userLocked: false };
}

/**
 * Shared open/close policy for process rows (thinking, tools, file diffs).
 * User toggles lock the state so streaming/phase effects cannot fight the user.
 */
export function reduceProcessExpandState(
  state: ProcessExpandState,
  event: ProcessExpandEvent,
  policy: ProcessExpandPolicy,
): ProcessExpandState {
  switch (event.type) {
    case "user-toggle":
      return { open: !state.open, userLocked: true };
    case "set-default":
      if (state.userLocked) return state;
      return { ...state, open: event.open };
    case "stream-start":
      if (policy !== "thinking") return state;
      if (state.userLocked) return state;
      return { ...state, open: true };
    case "stream-end":
      if (policy !== "thinking") return state;
      if (state.userLocked) return state;
      return { ...state, open: false };
    case "phase-error":
      if (policy === "thinking") return state;
      if (state.userLocked) return state;
      return { ...state, open: true };
    default:
      return state;
  }
}

export function resolveFileChangeDefaultOpen(options: {
  fileCount: number;
  phase: "queued" | "running" | "done" | "error" | "unknown";
}): boolean {
  return options.fileCount === 1 || options.phase === "error";
}
