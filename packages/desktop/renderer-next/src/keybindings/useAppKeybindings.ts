import { useCallback, useEffect, useMemo, useState } from "react";
import {
  APP_KEYBINDINGS_CHANGE_EVENT,
  APP_KEYBINDINGS_STORAGE_KEY,
  loadAppKeybindings,
  resetStoredAppKeybinding,
  resetStoredAppKeybindings,
  updateStoredAppKeybinding,
  type AppCommandId,
  type AppKeybindings,
  type AppKeybindingUpdateResult,
  type MutableKeybindingStorage,
} from "./appKeybindings";

export interface AppKeybindingsController {
  keybindings: AppKeybindings;
  updateKeybinding(commandId: AppCommandId, binding: string): AppKeybindingUpdateResult;
  clearKeybinding(commandId: AppCommandId): AppKeybindingUpdateResult;
  resetKeybinding(commandId: AppCommandId): AppKeybindingUpdateResult;
  resetAllKeybindings(): AppKeybindingUpdateResult;
}

function getLocalStorage(): MutableKeybindingStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function useAppKeybindings(): AppKeybindingsController {
  const [keybindings, setKeybindings] = useState<AppKeybindings>(() => loadAppKeybindings(getLocalStorage()));

  useEffect(() => {
    function reloadKeybindings(): void {
      setKeybindings(loadAppKeybindings(getLocalStorage()));
    }

    function handleStorage(event: StorageEvent): void {
      if (event.key === null || event.key === APP_KEYBINDINGS_STORAGE_KEY) reloadKeybindings();
    }

    window.addEventListener(APP_KEYBINDINGS_CHANGE_EVENT, reloadKeybindings);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(APP_KEYBINDINGS_CHANGE_EVENT, reloadKeybindings);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  const updateKeybinding = useCallback((commandId: AppCommandId, binding: string) => {
    const result = updateStoredAppKeybinding(commandId, binding);
    if (result.ok) setKeybindings(result.keybindings);
    return result;
  }, []);

  const clearKeybinding = useCallback((commandId: AppCommandId) => {
    const result = updateStoredAppKeybinding(commandId, "");
    if (result.ok) setKeybindings(result.keybindings);
    return result;
  }, []);

  const resetKeybinding = useCallback((commandId: AppCommandId) => {
    const result = resetStoredAppKeybinding(commandId);
    if (result.ok) setKeybindings(result.keybindings);
    return result;
  }, []);

  const resetAllKeybindings = useCallback(() => {
    const result = resetStoredAppKeybindings();
    if (result.ok) setKeybindings(result.keybindings);
    return result;
  }, []);

  return useMemo(() => ({
    keybindings,
    updateKeybinding,
    clearKeybinding,
    resetKeybinding,
    resetAllKeybindings,
  }), [clearKeybinding, keybindings, resetAllKeybindings, resetKeybinding, updateKeybinding]);
}
