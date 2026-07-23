// Pure command-history model for the Workbench one-shot terminal. Mirrors a
// real shell's up/down recall: submitted commands are remembered newest-last,
// arrow-up walks toward older entries, arrow-down walks back toward the live
// draft. A `cursor` of null means "editing the live draft" (not in history).

const MAX_HISTORY = 100;

export interface CommandHistoryState {
  // Submitted commands, oldest first. Consecutive duplicates are collapsed.
  entries: string[];
  // Index into `entries` while recalling, or null when editing the live draft.
  cursor: number | null;
  // The in-progress draft stashed when recall begins, restored on return.
  draft: string;
}

export function createCommandHistoryState(): CommandHistoryState {
  return { entries: [], cursor: null, draft: "" };
}

// Records a submitted command. Blank commands are ignored; a command identical
// to the most recent entry is not duplicated. Recall always resets to the draft.
export function pushCommand(state: CommandHistoryState, command: string): CommandHistoryState {
  const trimmed = command.trim();
  if (!trimmed) return { ...state, cursor: null, draft: "" };
  const last = state.entries[state.entries.length - 1];
  const entries = last === trimmed ? state.entries : [...state.entries, trimmed];
  const trimmedEntries = entries.length > MAX_HISTORY ? entries.slice(entries.length - MAX_HISTORY) : entries;
  return { entries: trimmedEntries, cursor: null, draft: "" };
}

export interface RecallResult {
  state: CommandHistoryState;
  // The value the input should show, or null when nothing changed (caller keeps
  // the current input, e.g. arrow-up at the oldest entry).
  value: string | null;
}

// Arrow-up: move toward older entries. Stashes the live draft on first step so
// arrow-down can restore it. At the oldest entry it stays put.
export function recallPrevious(state: CommandHistoryState, currentInput: string): RecallResult {
  if (state.entries.length === 0) return { state, value: null };
  if (state.cursor === null) {
    const cursor = state.entries.length - 1;
    return { state: { ...state, cursor, draft: currentInput }, value: state.entries[cursor] };
  }
  if (state.cursor === 0) return { state, value: null };
  const cursor = state.cursor - 1;
  return { state: { ...state, cursor }, value: state.entries[cursor] };
}

// Arrow-down: move toward newer entries. Stepping past the newest entry returns
// to the stashed live draft and exits recall.
export function recallNext(state: CommandHistoryState): RecallResult {
  if (state.cursor === null) return { state, value: null };
  if (state.cursor >= state.entries.length - 1) {
    return { state: { ...state, cursor: null }, value: state.draft };
  }
  const cursor = state.cursor + 1;
  return { state: { ...state, cursor }, value: state.entries[cursor] };
}
