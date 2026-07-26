export const APP_COMMAND_IDS = [
  "open-command-palette",
  "open-settings",
  "new-thread",
  "focus-thread-search",
  "focus-composer",
  "switch-workspace",
  "toggle-workbench",
  "open-workbench-review",
  "open-workbench-terminal",
  "open-workbench-browser",
  "open-workbench-files",
  "open-workbench-side-task",
  "copy-last-reply",
] as const;

export type AppCommandId = (typeof APP_COMMAND_IDS)[number];
export type AppPlatform = "mac" | "other";
export type AppKeybindings = Record<AppCommandId, string>;

export interface AppCommandMetadata {
  label: string;
  description: string;
}

export const APP_COMMAND_METADATA: Record<AppCommandId, AppCommandMetadata> = {
  "open-command-palette": {
    label: "Command Palette",
    description: "Find and run an application command.",
  },
  "open-settings": {
    label: "Open Settings",
    description: "Open application settings.",
  },
  "new-thread": {
    label: "New Thread",
    description: "Start a new agent session in the current workspace.",
  },
  "focus-thread-search": {
    label: "Search Threads",
    description: "Move focus to the thread search field.",
  },
  "focus-composer": {
    label: "Focus Message Input",
    description: "Move focus to the prompt composer.",
  },
  "switch-workspace": {
    label: "Switch Workspace",
    description: "Open the workspace switcher.",
  },
  "toggle-workbench": {
    label: "Toggle Workbench",
    description: "Open or close the right workbench.",
  },
  "open-workbench-review": {
    label: "Open Review",
    description: "Open branch and review tools in the workbench.",
  },
  "open-workbench-terminal": {
    label: "Open Terminal",
    description: "Open the terminal in the workbench.",
  },
  "open-workbench-browser": {
    label: "Open Browser",
    description: "Open browser actions in the workbench.",
  },
  "open-workbench-files": {
    label: "Open Files",
    description: "Open workspace file search in the workbench.",
  },
  "open-workbench-side-task": {
    label: "Open Side Task",
    description: "Create a task from the workbench.",
  },
  "copy-last-reply": {
    label: "Copy Last Reply",
    description: "Copy the assistant's latest reply as plain text.",
  },
};

export interface KeybindingStorage {
  getItem(key: string): string | null;
}

export interface MutableKeybindingStorage extends KeybindingStorage {
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface KeyboardShortcutEvent {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  defaultPrevented?: boolean;
  isComposing?: boolean;
  repeat?: boolean;
}

interface ParsedKeybinding {
  key: string;
  alt: boolean;
  ctrl: boolean;
  meta: boolean;
  mod: boolean;
  shift: boolean;
}

export type AppKeybindingErrorCode = "invalid" | "conflict" | "storage";

export interface AppKeybindingError {
  code: AppKeybindingErrorCode;
  message: string;
  conflictingCommandId?: AppCommandId;
  platform?: AppPlatform;
}

export type AppKeybindingUpdateResult =
  | { ok: true; keybindings: AppKeybindings; binding: string }
  | { ok: false; error: AppKeybindingError };

export type AppKeybindingsSaveResult =
  | { ok: true }
  | { ok: false; error: AppKeybindingError };

export type AppKeybindingCaptureResult =
  | { type: "binding"; binding: string }
  | { type: "cancel" }
  | { type: "clear" }
  | { type: "error"; message: string }
  | { type: "ignored" }
  | { type: "pending" };

export const APP_KEYBINDINGS_STORAGE_KEY = "pi-studio-app-keybindings";
export const APP_KEYBINDINGS_CHANGE_EVENT = "pi-studio:app-keybindings-change";

export const DEFAULT_APP_KEYBINDINGS: AppKeybindings = {
  "open-command-palette": "Mod+K",
  "open-settings": "Mod+,",
  "new-thread": "Mod+N",
  "focus-thread-search": "Mod+Shift+F",
  "focus-composer": "Mod+L",
  "switch-workspace": "Mod+Shift+O",
  "toggle-workbench": "Ctrl+Shift+Y",
  "open-workbench-review": "Ctrl+Shift+G",
  "open-workbench-terminal": "Ctrl+`",
  "open-workbench-browser": "Ctrl+T",
  "open-workbench-files": "Ctrl+P",
  "open-workbench-side-task": "Ctrl+Alt+S",
  "copy-last-reply": "Mod+Shift+C",
};

const COMMAND_ID_SET = new Set<string>(APP_COMMAND_IDS);
const MODIFIER_KEYS = new Set(["alt", "altgraph", "control", "meta", "shift"]);
const NAMED_KEYS = new Map<string, string>([
  ["arrowdown", "ArrowDown"],
  ["arrowleft", "ArrowLeft"],
  ["arrowright", "ArrowRight"],
  ["arrowup", "ArrowUp"],
  ["backspace", "Backspace"],
  ["delete", "Delete"],
  ["end", "End"],
  ["enter", "Enter"],
  ["escape", "Escape"],
  ["home", "Home"],
  ["pagedown", "PageDown"],
  ["pageup", "PageUp"],
  ["space", "Space"],
  ["tab", "Tab"],
]);

function normalizeKey(rawKey: string): string | null {
  const key = rawKey.trim();
  if (key.length === 1) return /[a-z]/i.test(key) ? key.toUpperCase() : key;
  const namedKey = NAMED_KEYS.get(key.toLowerCase());
  if (namedKey) return namedKey;
  const functionKey = /^f([1-9]|1\d|2[0-4])$/i.exec(key);
  return functionKey ? `F${functionKey[1]}` : null;
}

function parseKeybinding(binding: string): ParsedKeybinding | null {
  const parts = binding.split("+").map((part) => part.trim());
  if (parts.length === 0 || parts.some((part) => part.length === 0)) return null;

  const key = normalizeKey(parts[parts.length - 1]);
  if (!key) return null;

  const parsed: ParsedKeybinding = {
    key,
    alt: false,
    ctrl: false,
    meta: false,
    mod: false,
    shift: false,
  };

  for (const rawModifier of parts.slice(0, -1)) {
    const modifier = rawModifier.toLowerCase();
    if (modifier === "alt" && !parsed.alt) parsed.alt = true;
    else if ((modifier === "ctrl" || modifier === "control") && !parsed.ctrl) parsed.ctrl = true;
    else if ((modifier === "cmd" || modifier === "command" || modifier === "meta") && !parsed.meta) parsed.meta = true;
    else if (modifier === "mod" && !parsed.mod) parsed.mod = true;
    else if (modifier === "shift" && !parsed.shift) parsed.shift = true;
    else return null;
  }

  if (parsed.mod && (parsed.ctrl || parsed.meta)) return null;
  const hasCommandModifier = parsed.alt || parsed.ctrl || parsed.meta || parsed.mod;
  if (!hasCommandModifier && !/^F([1-9]|1\d|2[0-4])$/.test(parsed.key)) return null;
  return parsed;
}

function serializeKeybinding(parsed: ParsedKeybinding): string {
  return [
    parsed.mod ? "Mod" : "",
    parsed.ctrl ? "Ctrl" : "",
    parsed.meta ? "Meta" : "",
    parsed.alt ? "Alt" : "",
    parsed.shift ? "Shift" : "",
    parsed.key,
  ].filter(Boolean).join("+");
}

export function normalizeAppKeybinding(binding: string): string | null {
  if (binding.trim() === "") return "";
  const parsed = parseKeybinding(binding);
  return parsed ? serializeKeybinding(parsed) : null;
}

function bindingIdentity(binding: string, platform: AppPlatform): string | null {
  const parsed = parseKeybinding(binding);
  if (!parsed) return null;
  const ctrl = parsed.ctrl || (parsed.mod && platform === "other");
  const meta = parsed.meta || (parsed.mod && platform === "mac");
  return [ctrl, meta, parsed.alt, parsed.shift, parsed.key.toLowerCase()].join(":");
}

function findAppKeybindingConflict(
  keybindings: AppKeybindings,
  commandId: AppCommandId,
): { commandId: AppCommandId; platform: AppPlatform } | null {
  const binding = keybindings[commandId];
  if (binding === "") return null;

  for (const platform of ["mac", "other"] as const) {
    const identity = bindingIdentity(binding, platform);
    if (!identity) continue;
    for (const candidate of APP_COMMAND_IDS) {
      if (candidate === commandId || keybindings[candidate] === "") continue;
      if (bindingIdentity(keybindings[candidate], platform) === identity) {
        return { commandId: candidate, platform };
      }
    }
  }
  return null;
}

function hasAppKeybindingConflicts(keybindings: AppKeybindings): boolean {
  for (const platform of ["mac", "other"] as const) {
    const identities = new Set<string>();
    for (const commandId of APP_COMMAND_IDS) {
      const identity = bindingIdentity(keybindings[commandId], platform);
      if (!identity) continue;
      if (identities.has(identity)) return true;
      identities.add(identity);
    }
  }
  return false;
}

export function loadAppKeybindings(storage: KeybindingStorage | null): AppKeybindings {
  let raw: string | null;
  try {
    raw = storage?.getItem(APP_KEYBINDINGS_STORAGE_KEY) ?? null;
  } catch {
    return { ...DEFAULT_APP_KEYBINDINGS };
  }
  if (raw === null) return { ...DEFAULT_APP_KEYBINDINGS };

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_APP_KEYBINDINGS };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ...DEFAULT_APP_KEYBINDINGS };
  }

  const overrides = value as Record<string, unknown>;
  if (Object.keys(overrides).some((commandId) => !COMMAND_ID_SET.has(commandId))) {
    return { ...DEFAULT_APP_KEYBINDINGS };
  }

  const keybindings = { ...DEFAULT_APP_KEYBINDINGS };
  for (const commandId of APP_COMMAND_IDS) {
    const override = overrides[commandId];
    if (override === undefined) continue;
    if (typeof override !== "string") return { ...DEFAULT_APP_KEYBINDINGS };
    const normalized = normalizeAppKeybinding(override);
    if (normalized === null) return { ...DEFAULT_APP_KEYBINDINGS };
    keybindings[commandId] = normalized;
  }

  return hasAppKeybindingConflicts(keybindings) ? { ...DEFAULT_APP_KEYBINDINGS } : keybindings;
}

export function updateAppKeybinding(
  current: AppKeybindings,
  commandId: AppCommandId,
  binding: string,
): AppKeybindingUpdateResult {
  const normalized = normalizeAppKeybinding(binding);
  if (normalized === null) {
    return {
      ok: false,
      error: {
        code: "invalid",
        message: "Use a modifier with a key, or choose a function key from F1 through F24.",
      },
    };
  }

  const keybindings = { ...current, [commandId]: normalized };
  const conflict = findAppKeybindingConflict(keybindings, commandId);
  if (conflict) {
    const platformName = conflict.platform === "mac" ? "macOS" : "Windows and Linux";
    return {
      ok: false,
      error: {
        code: "conflict",
        message: `This shortcut conflicts with ${APP_COMMAND_METADATA[conflict.commandId].label} on ${platformName}.`,
        conflictingCommandId: conflict.commandId,
        platform: conflict.platform,
      },
    };
  }

  return { ok: true, keybindings, binding: normalized };
}

export function resetAppKeybinding(
  current: AppKeybindings,
  commandId: AppCommandId,
): AppKeybindingUpdateResult {
  return updateAppKeybinding(current, commandId, DEFAULT_APP_KEYBINDINGS[commandId]);
}

export function captureAppKeybinding(
  event: KeyboardShortcutEvent,
  platform: AppPlatform,
): AppKeybindingCaptureResult {
  if (event.key === "Escape") return { type: "cancel" };
  if (!isKeyboardShortcutEventEligible(event)) return { type: "ignored" };
  if (MODIFIER_KEYS.has(event.key.toLowerCase())) return { type: "pending" };

  const hasModifier = event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;
  if (!hasModifier && (event.key === "Backspace" || event.key === "Delete")) {
    return { type: "clear" };
  }

  const rawKey = event.key === " " ? "Space" : event.key;
  const key = normalizeKey(rawKey);
  if (!key) {
    return { type: "error", message: "That key cannot be used as an application shortcut." };
  }

  const hasCommandModifier = event.altKey || event.ctrlKey || event.metaKey;
  if (!hasCommandModifier && !/^F([1-9]|1\d|2[0-4])$/.test(key)) {
    const message = /^[a-z]$/i.test(key)
      ? "Add Ctrl, Alt, or Command to use a letter shortcut."
      : "Add Ctrl, Alt, or Command, or choose a function key from F1 through F24.";
    return { type: "error", message };
  }

  const usePrimaryModifier = platform === "mac"
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
  const parsed: ParsedKeybinding = {
    key,
    alt: event.altKey,
    ctrl: event.ctrlKey && !usePrimaryModifier,
    meta: event.metaKey && !usePrimaryModifier,
    mod: usePrimaryModifier,
    shift: event.shiftKey,
  };
  return { type: "binding", binding: serializeKeybinding(parsed) };
}

export function saveAppKeybindings(
  storage: MutableKeybindingStorage | null,
  keybindings: AppKeybindings,
): AppKeybindingsSaveResult {
  if (!storage) {
    return {
      ok: false,
      error: { code: "storage", message: "Shortcuts cannot be saved because local storage is unavailable." },
    };
  }

  const overrides: Partial<AppKeybindings> = {};
  for (const commandId of APP_COMMAND_IDS) {
    if (keybindings[commandId] !== DEFAULT_APP_KEYBINDINGS[commandId]) {
      overrides[commandId] = keybindings[commandId];
    }
  }

  try {
    if (Object.keys(overrides).length === 0) storage.removeItem(APP_KEYBINDINGS_STORAGE_KEY);
    else storage.setItem(APP_KEYBINDINGS_STORAGE_KEY, JSON.stringify(overrides));
    return { ok: true };
  } catch {
    return {
      ok: false,
      error: { code: "storage", message: "The shortcut could not be saved to local storage." },
    };
  }
}

function getBrowserKeybindingStorage(): MutableKeybindingStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function notifyAppKeybindingsChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(APP_KEYBINDINGS_CHANGE_EVENT));
}

export function updateStoredAppKeybinding(
  commandId: AppCommandId,
  binding: string,
  storage: MutableKeybindingStorage | null = getBrowserKeybindingStorage(),
): AppKeybindingUpdateResult {
  const result = updateAppKeybinding(loadAppKeybindings(storage), commandId, binding);
  if (!result.ok) return result;
  const saved = saveAppKeybindings(storage, result.keybindings);
  if (!saved.ok) return saved;
  notifyAppKeybindingsChanged();
  return result;
}

export function resetStoredAppKeybinding(
  commandId: AppCommandId,
  storage: MutableKeybindingStorage | null = getBrowserKeybindingStorage(),
): AppKeybindingUpdateResult {
  const result = resetAppKeybinding(loadAppKeybindings(storage), commandId);
  if (!result.ok) return result;
  const saved = saveAppKeybindings(storage, result.keybindings);
  if (!saved.ok) return saved;
  notifyAppKeybindingsChanged();
  return result;
}

export function resetStoredAppKeybindings(
  storage: MutableKeybindingStorage | null = getBrowserKeybindingStorage(),
): AppKeybindingUpdateResult {
  const keybindings = { ...DEFAULT_APP_KEYBINDINGS };
  const saved = saveAppKeybindings(storage, keybindings);
  if (!saved.ok) return saved;
  notifyAppKeybindingsChanged();
  return { ok: true, keybindings, binding: "" };
}

export function getAppPlatform(platformDescription?: string): AppPlatform {
  const description = platformDescription ??
    (typeof navigator === "undefined" ? "" : `${navigator.platform} ${navigator.userAgent}`);
  return /Mac|iPhone|iPad|iPod/i.test(description) ? "mac" : "other";
}

export function isKeyboardShortcutEventEligible(event: KeyboardShortcutEvent): boolean {
  return !event.defaultPrevented && !event.isComposing && !event.repeat && event.key !== "Dead" && event.key !== "Process";
}

export function matchesAppKeybinding(
  event: KeyboardShortcutEvent,
  binding: string,
  platform: AppPlatform,
): boolean {
  const parsed = parseKeybinding(binding);
  if (!parsed) return false;

  const expectedCtrl = parsed.ctrl || (parsed.mod && platform === "other");
  const expectedMeta = parsed.meta || (parsed.mod && platform === "mac");
  const eventKey = event.key === " " ? "Space" : event.key;
  return eventKey.toLowerCase() === parsed.key.toLowerCase()
    && event.altKey === parsed.alt
    && event.ctrlKey === expectedCtrl
    && event.metaKey === expectedMeta
    && event.shiftKey === parsed.shift;
}

export function formatAppKeybinding(binding: string, platform: AppPlatform): string {
  const parsed = parseKeybinding(binding);
  if (!parsed) return binding;

  if (platform === "mac") {
    return [
      parsed.ctrl ? "⌃" : "",
      parsed.alt ? "⌥" : "",
      parsed.shift ? "⇧" : "",
      parsed.meta || parsed.mod ? "⌘" : "",
      parsed.key === "Space" ? "Space" : parsed.key,
    ].join("");
  }

  return [
    parsed.mod || parsed.ctrl ? "Ctrl" : "",
    parsed.meta ? "Meta" : "",
    parsed.alt ? "Alt" : "",
    parsed.shift ? "Shift" : "",
    parsed.key,
  ].filter(Boolean).join("+");
}

export function toAriaKeyshortcuts(binding: string, platform: AppPlatform): string | undefined {
  const parsed = parseKeybinding(binding);
  if (!parsed) return undefined;
  return [
    parsed.ctrl || (parsed.mod && platform === "other") ? "Control" : "",
    parsed.meta || (parsed.mod && platform === "mac") ? "Meta" : "",
    parsed.alt ? "Alt" : "",
    parsed.shift ? "Shift" : "",
    parsed.key,
  ].filter(Boolean).join("+");
}
