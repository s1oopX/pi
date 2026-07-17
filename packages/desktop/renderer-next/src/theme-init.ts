const storedTheme = (() => {
  try {
    return localStorage.getItem("pi-studio-theme");
  } catch {
    return null;
  }
})();

const storedAppearance = (() => {
  try {
    const raw = localStorage.getItem("pi-studio-appearance");
    if (!raw) return { fontScale: 1, density: "comfortable" as const };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { fontScale: 1, density: "comfortable" as const };
    }
    const record = parsed as Record<string, unknown>;
    const fontScale = typeof record.fontScale === "number" && [0.9, 1, 1.1, 1.2].includes(record.fontScale)
      ? record.fontScale
      : 1;
    const density = record.density === "compact" ? "compact" as const : "comfortable" as const;
    return { fontScale, density };
  } catch {
    return { fontScale: 1, density: "comfortable" as const };
  }
})();

const resolvedTheme =
  storedTheme === "dark" ||
  (storedTheme !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches)
    ? "dark"
    : "light";

if (/Windows/i.test(navigator.userAgent)) {
  document.documentElement.dataset.windowControlsOverlay = "true";
}

document.documentElement.dataset.theme = resolvedTheme;
document.documentElement.dataset.themeMode = storedTheme === "light" || storedTheme === "dark" ? storedTheme : "system";
document.documentElement.dataset.density = storedAppearance.density;
document.documentElement.style.colorScheme = resolvedTheme;
document.documentElement.style.setProperty("--root-font-size", `${16 * storedAppearance.fontScale}px`);
document.documentElement.style.setProperty("--font-scale", String(storedAppearance.fontScale));
