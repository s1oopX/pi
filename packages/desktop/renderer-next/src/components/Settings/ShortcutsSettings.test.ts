import { describe, expect, it } from "vitest";
import {
  APP_KEYBINDINGS_STORAGE_KEY,
  DEFAULT_APP_KEYBINDINGS,
  captureAppKeybinding,
  loadAppKeybindings,
  resetAppKeybinding,
  resetStoredAppKeybinding,
  updateAppKeybinding,
  updateStoredAppKeybinding,
  type KeyboardShortcutEvent,
  type MutableKeybindingStorage,
} from "../../keybindings/appKeybindings";

interface MemoryStorage extends MutableKeybindingStorage {
  read(): string | null;
}

function createMemoryStorage(initial: string | null = null): MemoryStorage {
  let value = initial;
  return {
    getItem(key) {
      expect(key).toBe(APP_KEYBINDINGS_STORAGE_KEY);
      return value;
    },
    setItem(key, nextValue) {
      expect(key).toBe(APP_KEYBINDINGS_STORAGE_KEY);
      value = nextValue;
    },
    removeItem(key) {
      expect(key).toBe(APP_KEYBINDINGS_STORAGE_KEY);
      value = null;
    },
    read() {
      return value;
    },
  };
}

function keyEvent(overrides: Partial<KeyboardShortcutEvent> = {}): KeyboardShortcutEvent {
  return {
    key: "k",
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...overrides,
  };
}

describe("shortcut recording", () => {
  it("records the platform primary modifier as Mod", () => {
    expect(captureAppKeybinding(keyEvent({ ctrlKey: true }), "other")).toEqual({
      type: "binding",
      binding: "Mod+K",
    });
    expect(captureAppKeybinding(keyEvent({ metaKey: true, shiftKey: true }), "mac")).toEqual({
      type: "binding",
      binding: "Mod+Shift+K",
    });
  });

  it("rejects an unmodified letter with an actionable message", () => {
    expect(captureAppKeybinding(keyEvent({ key: "a" }), "other")).toEqual({
      type: "error",
      message: "Add Ctrl, Alt, or Command to use a letter shortcut.",
    });
  });

  it("classifies cancel, modifier-only, and clear keys without component key checks", () => {
    expect(captureAppKeybinding(keyEvent({ key: "Escape" }), "other")).toEqual({ type: "cancel" });
    expect(captureAppKeybinding(keyEvent({ key: "Control", ctrlKey: true }), "other")).toEqual({ type: "pending" });
    expect(captureAppKeybinding(keyEvent({ key: "Backspace" }), "other")).toEqual({ type: "clear" });
  });
});

describe("shortcut updates", () => {
  it("reports Windows/Linux and macOS conflicts without mutating the active bindings", () => {
    const current = { ...DEFAULT_APP_KEYBINDINGS };
    const windowsConflict = updateAppKeybinding(current, "open-settings", "Ctrl+K");
    const macConflict = updateAppKeybinding(current, "open-settings", "Meta+K");

    expect(windowsConflict).toMatchObject({
      ok: false,
      error: { code: "conflict", conflictingCommandId: "open-command-palette", platform: "other" },
    });
    expect(macConflict).toMatchObject({
      ok: false,
      error: { code: "conflict", conflictingCommandId: "open-command-palette", platform: "mac" },
    });
    expect(current).toEqual(DEFAULT_APP_KEYBINDINGS);
  });

  it("supports unassigned commands while preserving conflicts for assigned commands", () => {
    const cleared = updateAppKeybinding(DEFAULT_APP_KEYBINDINGS, "open-command-palette", "");
    expect(cleared).toMatchObject({ ok: true, binding: "" });
    if (!cleared.ok) throw new Error("Expected the shortcut to clear");

    const reassigned = updateAppKeybinding(cleared.keybindings, "new-thread", "Mod+K");
    expect(reassigned).toMatchObject({ ok: true, binding: "Mod+K" });
    expect(DEFAULT_APP_KEYBINDINGS["open-command-palette"]).toBe("Mod+K");
  });

  it("keeps custom bindings when restoring one default would conflict", () => {
    const cleared = updateAppKeybinding(DEFAULT_APP_KEYBINDINGS, "open-command-palette", "");
    if (!cleared.ok) throw new Error("Expected the shortcut to clear");
    const reassigned = updateAppKeybinding(cleared.keybindings, "new-thread", "Mod+K");
    if (!reassigned.ok) throw new Error("Expected the shortcut to be reassigned");

    const reset = resetAppKeybinding(reassigned.keybindings, "open-command-palette");
    expect(reset).toMatchObject({
      ok: false,
      error: { code: "conflict", conflictingCommandId: "new-thread" },
    });
    expect(reassigned.keybindings["open-command-palette"]).toBe("");
    expect(reassigned.keybindings["new-thread"]).toBe("Mod+K");
  });
});

describe("shortcut persistence", () => {
  it("persists only overrides and removes storage after restoring the last default", () => {
    const storage = createMemoryStorage();
    const updated = updateStoredAppKeybinding("open-settings", "Alt+S", storage);

    expect(updated).toMatchObject({ ok: true, binding: "Alt+S" });
    expect(JSON.parse(storage.read() ?? "null")).toEqual({ "open-settings": "Alt+S" });
    expect(loadAppKeybindings(storage)["open-settings"]).toBe("Alt+S");

    const reset = resetStoredAppKeybinding("open-settings", storage);
    expect(reset).toMatchObject({ ok: true, binding: DEFAULT_APP_KEYBINDINGS["open-settings"] });
    expect(storage.read()).toBeNull();
  });

  it("does not report a successful update when storage rejects the write", () => {
    const storage: MutableKeybindingStorage = {
      getItem() {
        return null;
      },
      setItem() {
        throw new Error("blocked");
      },
      removeItem() {
        throw new Error("blocked");
      },
    };

    expect(updateStoredAppKeybinding("open-settings", "Alt+S", storage)).toEqual({
      ok: false,
      error: { code: "storage", message: "The shortcut could not be saved to local storage." },
    });
  });
});
