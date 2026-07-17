import { describe, expect, it } from "vitest";
import { APPEARANCE_STORAGE_KEY, loadAppearancePreferences } from "./preferences";

describe("appearance preferences", () => {
  it("loads valid font scale and density values", () => {
    const storage = {
      getItem(key: string): string | null {
        return key === APPEARANCE_STORAGE_KEY ? JSON.stringify({ fontScale: 1.2, density: "compact" }) : null;
      },
    };
    expect(loadAppearancePreferences(storage)).toEqual({ fontScale: 1.2, density: "compact" });
  });

  it("falls back field-by-field for unsupported values", () => {
    const storage = {
      getItem(): string {
        return JSON.stringify({ fontScale: 4, density: "tiny" });
      },
    };
    expect(loadAppearancePreferences(storage)).toEqual({ fontScale: 1, density: "comfortable" });
  });
});
