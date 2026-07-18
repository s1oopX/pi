import { describe, expect, it } from "vitest";
import {
  clampWidth,
  getSidebarBoundsForViewport,
  getWorkbenchBoundsForViewport,
  loadPanelWidth,
  resolveKeyboardPanelWidth,
  resolvePanelWidth,
  savePanelWidth,
} from "./panelSizing";

describe("clampWidth", () => {
  it("keeps a width already inside the range", () => {
    expect(clampWidth(300, { min: 180, max: 520 })).toBe(300);
  });

  it("clamps below the minimum up to min", () => {
    expect(clampWidth(120, { min: 180, max: 520 })).toBe(180);
  });

  it("clamps above the maximum down to max", () => {
    expect(clampWidth(900, { min: 180, max: 520 })).toBe(520);
  });

  it("prefers min when the range is inverted", () => {
    expect(clampWidth(300, { min: 400, max: 200 })).toBe(400);
  });
});

describe("resolvePanelWidth", () => {
  it("does not collapse when the raw width stays above the threshold", () => {
    expect(resolvePanelWidth(200, { min: 180, max: 520 }, 150)).toEqual({
      width: 200,
      collapse: false,
    });
  });

  it("collapses when the raw width drops below the threshold", () => {
    expect(resolvePanelWidth(120, { min: 180, max: 520 }, 150)).toEqual({
      width: 180,
      collapse: true,
    });
  });

  it("collapses based on the raw width even after clamping raises it to min", () => {
    const result = resolvePanelWidth(40, { min: 180, max: 520 }, 150);
    expect(result.collapse).toBe(true);
    expect(result.width).toBe(180);
  });
});

describe("resolveKeyboardPanelWidth", () => {
  it("moves the separator with arrow keys for a left sidebar", () => {
    const bounds = { min: 180, max: 520 };
    expect(resolveKeyboardPanelWidth("ArrowRight", false, 300, bounds, "right")).toBe(316);
    expect(resolveKeyboardPanelWidth("ArrowLeft", false, 300, bounds, "right")).toBe(284);
  });

  it("moves the separator with arrow keys for a right workbench", () => {
    const bounds = { min: 360, max: 720 };
    expect(resolveKeyboardPanelWidth("ArrowLeft", false, 460, bounds, "left")).toBe(476);
    expect(resolveKeyboardPanelWidth("ArrowRight", false, 460, bounds, "left")).toBe(444);
  });

  it("supports larger steps and min/max keys", () => {
    const bounds = { min: 180, max: 520 };
    expect(resolveKeyboardPanelWidth("ArrowRight", true, 300, bounds, "right")).toBe(364);
    expect(resolveKeyboardPanelWidth("Home", false, 300, bounds, "right")).toBe(180);
    expect(resolveKeyboardPanelWidth("End", false, 300, bounds, "right")).toBe(520);
    expect(resolveKeyboardPanelWidth("PageUp", false, 300, bounds, "right")).toBeNull();
  });
});

describe("responsive panel bounds", () => {
  it("keeps the sidebar from crowding the main panel on narrow viewports", () => {
    expect(getSidebarBoundsForViewport(1600)).toEqual({ min: 220, max: 520 });
    expect(getSidebarBoundsForViewport(800)).toEqual({ min: 224, max: 480 });
    expect(getSidebarBoundsForViewport(480)).toEqual({ min: 204, max: 204 });
  });

  it("caps the workbench so the conversation keeps its minimum side-by-side width", () => {
    expect(getWorkbenchBoundsForViewport(1600, 275)).toEqual({ min: 360, max: 720 });
    expect(getWorkbenchBoundsForViewport(1200, 275)).toEqual({ min: 360, max: 565 });
    expect(getWorkbenchBoundsForViewport(900, 275)).toEqual({ min: 360, max: 360 });
  });
});

describe("loadPanelWidth / savePanelWidth", () => {
  it("returns the fallback when nothing is stored", () => {
    const store = new Map<string, string>();
    expect(loadPanelWidth({ getItem: (k) => store.get(k) ?? null }, "sidebar", 275)).toBe(275);
  });

  it("round-trips a saved width", () => {
    const store = new Map<string, string>();
    savePanelWidth({ setItem: (k, v) => void store.set(k, v) }, "sidebar", 312.6);
    expect(loadPanelWidth({ getItem: (k) => store.get(k) ?? null }, "sidebar", 275)).toBe(313);
  });

  it("ignores a non-positive or unparsable stored value", () => {
    const store = new Map<string, string>([
      ["pi-studio:panel-width:sidebar", "-5"],
      ["pi-studio:panel-width:workbench", "nope"],
    ]);
    const getItem = (k: string) => store.get(k) ?? null;
    expect(loadPanelWidth({ getItem }, "sidebar", 275)).toBe(275);
    expect(loadPanelWidth({ getItem }, "workbench", 480)).toBe(480);
  });
});
