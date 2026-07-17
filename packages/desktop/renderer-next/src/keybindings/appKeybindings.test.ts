import { describe, expect, it } from "vitest";
import {
  APP_KEYBINDINGS_STORAGE_KEY,
  DEFAULT_APP_KEYBINDINGS,
  formatAppKeybinding,
  getAppPlatform,
  isKeyboardShortcutEventEligible,
  loadAppKeybindings,
  matchesAppKeybinding,
  toAriaKeyshortcuts,
  type KeyboardShortcutEvent,
  type KeybindingStorage,
} from "./appKeybindings";

function storageWith(value: string | null): KeybindingStorage {
  return {
    getItem(key) {
      expect(key).toBe(APP_KEYBINDINGS_STORAGE_KEY);
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

describe("app keybindings", () => {
  it("loads validated partial user overrides and keeps remaining defaults", () => {
    const bindings = loadAppKeybindings(storageWith(JSON.stringify({
      "open-settings": "Alt+S",
      "focus-composer": "F8",
    })));

    expect(bindings["open-settings"]).toBe("Alt+S");
    expect(bindings["focus-composer"]).toBe("F8");
    expect(bindings["new-thread"]).toBe(DEFAULT_APP_KEYBINDINGS["new-thread"]);
  });

  it.each([
    "not-json",
    "[]",
    JSON.stringify({ unknown: "Mod+Q" }),
    JSON.stringify({ "open-settings": "S" }),
    JSON.stringify({ "open-settings": "Mod+Mod+S" }),
    JSON.stringify({ "open-settings": "Mod+K" }),
    JSON.stringify({ "open-settings": "Ctrl+K" }),
    JSON.stringify({ "open-settings": "Meta+K" }),
  ])("falls back to the complete defaults for invalid storage: %s", (raw) => {
    expect(loadAppKeybindings(storageWith(raw))).toEqual(DEFAULT_APP_KEYBINDINGS);
  });

  it("falls back when storage access throws", () => {
    expect(loadAppKeybindings({ getItem() { throw new Error("blocked"); } })).toEqual(DEFAULT_APP_KEYBINDINGS);
  });

  it("maps Mod to Ctrl on Windows and Command on macOS with exact modifiers", () => {
    expect(matchesAppKeybinding(keyEvent({ ctrlKey: true }), "Mod+K", "other")).toBe(true);
    expect(matchesAppKeybinding(keyEvent({ metaKey: true }), "Mod+K", "mac")).toBe(true);
    expect(matchesAppKeybinding(keyEvent({ ctrlKey: true, shiftKey: true }), "Mod+K", "other")).toBe(false);
    expect(matchesAppKeybinding(keyEvent({ ctrlKey: true, altKey: true }), "Mod+K", "other")).toBe(false);
  });

  it("rejects repeated, composing, prevented, and IME/dead-key events", () => {
    expect(isKeyboardShortcutEventEligible(keyEvent())).toBe(true);
    expect(isKeyboardShortcutEventEligible(keyEvent({ repeat: true }))).toBe(false);
    expect(isKeyboardShortcutEventEligible(keyEvent({ isComposing: true }))).toBe(false);
    expect(isKeyboardShortcutEventEligible(keyEvent({ defaultPrevented: true }))).toBe(false);
    expect(isKeyboardShortcutEventEligible(keyEvent({ key: "Process" }))).toBe(false);
    expect(isKeyboardShortcutEventEligible(keyEvent({ key: "Dead" }))).toBe(false);
  });

  it("formats visible and assistive shortcut labels for each platform", () => {
    expect(formatAppKeybinding("Mod+Shift+F", "other")).toBe("Ctrl+Shift+F");
    expect(formatAppKeybinding("Mod+Shift+F", "mac")).toBe("⇧⌘F");
    expect(toAriaKeyshortcuts("Mod+,", "other")).toBe("Control+,");
    expect(toAriaKeyshortcuts("Mod+,", "mac")).toBe("Meta+,");
    expect(getAppPlatform("Win32 Mozilla/5.0")).toBe("other");
    expect(getAppPlatform("MacIntel Mozilla/5.0")).toBe("mac");
  });
});
