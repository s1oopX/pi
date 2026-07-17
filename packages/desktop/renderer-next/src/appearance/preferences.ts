import { useSyncExternalStore } from "react";
import type { PreferenceStorage } from "../i18n";

export const APPEARANCE_STORAGE_KEY = "pi-studio-appearance";
export const FONT_SCALE_OPTIONS = [0.9, 1, 1.1, 1.2] as const;
export const INTERFACE_DENSITIES = ["comfortable", "compact"] as const;

export type FontScale = (typeof FONT_SCALE_OPTIONS)[number];
export type InterfaceDensity = (typeof INTERFACE_DENSITIES)[number];

export interface AppearancePreferences {
  fontScale: FontScale;
  density: InterfaceDensity;
}

export const DEFAULT_APPEARANCE_PREFERENCES: AppearancePreferences = {
  fontScale: 1,
  density: "comfortable",
};

const listeners = new Set<() => void>();

function getBrowserStorage(): PreferenceStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isFontScale(value: unknown): value is FontScale {
  return typeof value === "number" && FONT_SCALE_OPTIONS.some((option) => option === value);
}

function isInterfaceDensity(value: unknown): value is InterfaceDensity {
  return typeof value === "string" && INTERFACE_DENSITIES.some((option) => option === value);
}

export function loadAppearancePreferences(
  storage: Pick<PreferenceStorage, "getItem"> | null,
): AppearancePreferences {
  try {
    const raw = storage?.getItem(APPEARANCE_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_APPEARANCE_PREFERENCES };
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return { ...DEFAULT_APPEARANCE_PREFERENCES };
    }
    const record = value as Record<string, unknown>;
    return {
      fontScale: isFontScale(record.fontScale) ? record.fontScale : DEFAULT_APPEARANCE_PREFERENCES.fontScale,
      density: isInterfaceDensity(record.density) ? record.density : DEFAULT_APPEARANCE_PREFERENCES.density,
    };
  } catch {
    return { ...DEFAULT_APPEARANCE_PREFERENCES };
  }
}

let snapshot = loadAppearancePreferences(getBrowserStorage());

function applyAppearancePreferences(preferences: AppearancePreferences): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.style.setProperty("--root-font-size", `${16 * preferences.fontScale}px`);
  root.style.setProperty("--font-scale", String(preferences.fontScale));
  root.dataset.density = preferences.density;
}

function saveAppearancePreferences(preferences: AppearancePreferences, storage: PreferenceStorage | null): void {
  try {
    if (
      preferences.fontScale === DEFAULT_APPEARANCE_PREFERENCES.fontScale &&
      preferences.density === DEFAULT_APPEARANCE_PREFERENCES.density
    ) {
      storage?.removeItem(APPEARANCE_STORAGE_KEY);
    } else {
      storage?.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(preferences));
    }
  } catch {}
}

function updateAppearancePreferences(
  preferences: AppearancePreferences,
  storage: PreferenceStorage | null = getBrowserStorage(),
): void {
  snapshot = preferences;
  saveAppearancePreferences(preferences, storage);
  applyAppearancePreferences(preferences);
  for (const listener of listeners) listener();
}

export function setFontScale(fontScale: FontScale): void {
  updateAppearancePreferences({ ...snapshot, fontScale });
}

export function setInterfaceDensity(density: InterfaceDensity): void {
  updateAppearancePreferences({ ...snapshot, density });
}

export function resetAppearancePreferences(): void {
  updateAppearancePreferences({ ...DEFAULT_APPEARANCE_PREFERENCES });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): AppearancePreferences {
  return snapshot;
}

export function useAppearancePreferences(): AppearancePreferences & {
  setFontScale: (fontScale: FontScale) => void;
  setDensity: (density: InterfaceDensity) => void;
  reset: () => void;
} {
  const preferences = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return {
    ...preferences,
    setFontScale,
    setDensity: setInterfaceDensity,
    reset: resetAppearancePreferences,
  };
}

applyAppearancePreferences(snapshot);
