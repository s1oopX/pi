import { useEffect } from "react";
import {
  APP_COMMAND_IDS,
  isKeyboardShortcutEventEligible,
  matchesAppKeybinding,
  type AppCommandId,
  type AppKeybindings,
  type AppPlatform,
} from "./appKeybindings";

export function useAppShortcuts(
  bindings: AppKeybindings,
  platform: AppPlatform,
  onCommand: (commandId: AppCommandId) => void,
): void {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!isKeyboardShortcutEventEligible(event)) return;
      if (event.target instanceof Element && event.target.closest("[data-app-shortcut-capture]")) return;
      if (document.querySelector("dialog[open]")) return;

      const commandId = APP_COMMAND_IDS.find((candidate) =>
        matchesAppKeybinding(event, bindings[candidate], platform),
      );
      if (!commandId) return;

      event.preventDefault();
      event.stopPropagation();
      onCommand(commandId);
    }

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [bindings, onCommand, platform]);
}
