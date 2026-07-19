import { useEffect } from "react";
import {
  APP_COMMAND_IDS,
  isKeyboardShortcutEventEligible,
  matchesAppKeybinding,
  type AppCommandId,
  type AppKeybindings,
  type AppPlatform,
} from "./appKeybindings";

const APP_MODAL_SELECTOR = 'dialog[open], [aria-modal="true"]';

interface AppShortcutQueryRoot {
  querySelector(selector: string): unknown;
}

export function hasBlockingAppModal(root: AppShortcutQueryRoot): boolean {
  return root.querySelector(APP_MODAL_SELECTOR) !== null;
}

export function isAppShortcutBlockedByModal(root: AppShortcutQueryRoot, commandId: AppCommandId): boolean {
  if (!hasBlockingAppModal(root)) return false;
  return commandId !== "open-command-palette" || root.querySelector("[data-app-command-palette]") === null;
}

export function useAppShortcuts(
  bindings: AppKeybindings,
  platform: AppPlatform,
  onCommand: (commandId: AppCommandId) => void,
): void {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!isKeyboardShortcutEventEligible(event)) return;
      if (event.target instanceof Element && event.target.closest("[data-app-shortcut-capture]")) return;

      const commandId = APP_COMMAND_IDS.find((candidate) =>
        matchesAppKeybinding(event, bindings[candidate], platform),
      );
      if (!commandId || isAppShortcutBlockedByModal(document, commandId)) return;

      event.preventDefault();
      event.stopPropagation();
      onCommand(commandId);
    }

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [bindings, onCommand, platform]);
}
