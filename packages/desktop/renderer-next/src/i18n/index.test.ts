import { describe, expect, it } from "vitest";
import {
  LANGUAGE_STORAGE_KEY,
  loadLanguagePreference,
  resolveLanguage,
  translateText,
  type PreferenceStorage,
} from "./index";

class MemoryStorage implements PreferenceStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe("i18n preferences", () => {
  it("resolves system Chinese locales and otherwise falls back to English", () => {
    expect(resolveLanguage("system", "zh-Hans-CN")).toBe("zh-CN");
    expect(resolveLanguage("system", "en-US")).toBe("en");
    expect(resolveLanguage("zh-CN", "en-US")).toBe("zh-CN");
  });

  it("loads only supported persisted language values", () => {
    const storage = new MemoryStorage();
    storage.setItem(LANGUAGE_STORAGE_KEY, "zh-CN");
    expect(loadLanguagePreference(storage)).toBe("zh-CN");

    storage.setItem(LANGUAGE_STORAGE_KEY, "fr");
    expect(loadLanguagePreference(storage)).toBe("system");
  });

  it("translates and interpolates values", () => {
    expect(translateText("en", "Found {count}", "找到 {count} 个", { count: 3 })).toBe("Found 3");
    expect(translateText("zh-CN", "Found {count}", "找到 {count} 个", { count: 3 })).toBe("找到 3 个");
  });
});
