import { useCallback, useSyncExternalStore } from "react";

export type LanguagePreference = "system" | "en" | "zh-CN";
export type ResolvedLanguage = Exclude<LanguagePreference, "system">;

export interface TranslationValues {
  [key: string]: string | number;
}

export interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const LANGUAGE_STORAGE_KEY = "pi-studio-language";

interface LanguageSnapshot {
  language: LanguagePreference;
  resolvedLanguage: ResolvedLanguage;
}

const listeners = new Set<() => void>();

function getBrowserStorage(): PreferenceStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function getSystemLanguage(): string {
  if (typeof navigator === "undefined") return "en";
  return navigator.languages?.[0] ?? navigator.language ?? "en";
}

export function resolveLanguage(
  language: LanguagePreference,
  systemLanguage = getSystemLanguage(),
): ResolvedLanguage {
  if (language !== "system") return language;
  return systemLanguage.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

export function loadLanguagePreference(storage: Pick<PreferenceStorage, "getItem"> | null): LanguagePreference {
  try {
    const saved = storage?.getItem(LANGUAGE_STORAGE_KEY);
    if (saved === "system" || saved === "en" || saved === "zh-CN") return saved;
  } catch {}
  return "system";
}

function createSnapshot(language: LanguagePreference): LanguageSnapshot {
  return { language, resolvedLanguage: resolveLanguage(language) };
}

let snapshot = createSnapshot(loadLanguagePreference(getBrowserStorage()));

function applyLanguageToDocument(language: ResolvedLanguage): void {
  if (typeof document !== "undefined") document.documentElement.lang = language;
}

function emitLanguageChange(nextSnapshot: LanguageSnapshot): void {
  snapshot = nextSnapshot;
  applyLanguageToDocument(snapshot.resolvedLanguage);
  for (const listener of listeners) listener();
}

export function setLanguagePreference(
  language: LanguagePreference,
  storage: PreferenceStorage | null = getBrowserStorage(),
): void {
  try {
    if (language === "system") storage?.removeItem(LANGUAGE_STORAGE_KEY);
    else storage?.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {}
  emitLanguageChange(createSnapshot(language));
}

export function translateText(
  language: ResolvedLanguage,
  english: string,
  simplifiedChinese: string,
  values?: TranslationValues,
): string {
  const template = language === "zh-CN" ? simplifiedChinese : english;
  if (!values) return template;
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key: string) => {
    const value = values[key];
    return value === undefined ? match : String(value);
  });
}

export function t(english: string, simplifiedChinese: string, values?: TranslationValues): string {
  return translateText(snapshot.resolvedLanguage, english, simplifiedChinese, values);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): LanguageSnapshot {
  return snapshot;
}

export function useI18n(): LanguageSnapshot & {
  setLanguage: (language: LanguagePreference) => void;
  t: (english: string, simplifiedChinese: string, values?: TranslationValues) => string;
} {
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const translate = useCallback(
    (english: string, simplifiedChinese: string, values?: TranslationValues) =>
      translateText(current.resolvedLanguage, english, simplifiedChinese, values),
    [current.resolvedLanguage],
  );
  return {
    ...current,
    setLanguage: setLanguagePreference,
    t: translate,
  };
}

applyLanguageToDocument(snapshot.resolvedLanguage);
if (typeof window !== "undefined") {
  window.addEventListener("languagechange", () => {
    if (snapshot.language === "system") emitLanguageChange(createSnapshot("system"));
  });
}
