export interface WidthBounds {
  min: number;
  max: number;
}

export type ResizeEdge = "left" | "right";

const STORAGE_PREFIX = "pi-studio:panel-width:";
const SIDEBAR_MIN = 220;
const SIDEBAR_MEDIUM_MIN = 224;
const SIDEBAR_COMPACT_MIN = 204;
const SIDEBAR_MAX = 520;
const SIDEBAR_MAIN_RESERVE = 320;
const WORKBENCH_MIN = 360;
const WORKBENCH_MAX = 720;
const WORKBENCH_CONVERSATION_MIN = 360;

/** Clamp a raw width into [min, max]. Guards against an inverted range where a
 * small viewport pushes max below min by preferring min. */
export function clampWidth(width: number, bounds: WidthBounds): number {
  const max = Math.max(bounds.min, bounds.max);
  return Math.max(bounds.min, Math.min(max, width));
}

/** Resolve a dragged raw width into the final width plus whether releasing here
 * should collapse the panel. Collapse wins based on the raw (pre-clamp) width so
 * dragging past the threshold always reads as an intent to collapse. */
export function resolvePanelWidth(
  raw: number,
  bounds: WidthBounds,
  collapseAt: number,
): { width: number; collapse: boolean } {
  return { width: clampWidth(raw, bounds), collapse: raw < collapseAt };
}

export function resolveKeyboardPanelWidth(
  key: string,
  shiftKey: boolean,
  currentWidth: number,
  bounds: WidthBounds,
  edge: ResizeEdge,
): number | null {
  if (key === "Home") return bounds.min;
  if (key === "End") return clampWidth(bounds.max, bounds);

  const step = shiftKey ? 64 : 16;
  const delta = key === "ArrowLeft" ? -step : key === "ArrowRight" ? step : null;
  if (delta === null) return null;

  const raw = edge === "right" ? currentWidth + delta : currentWidth - delta;
  return clampWidth(raw, bounds);
}

export function getSidebarBoundsForViewport(viewportWidth: number): WidthBounds {
  const width = Number.isFinite(viewportWidth) ? viewportWidth : 1024;
  const min = width <= 680 ? SIDEBAR_COMPACT_MIN : width <= 860 ? SIDEBAR_MEDIUM_MIN : SIDEBAR_MIN;
  return {
    min,
    max: Math.min(SIDEBAR_MAX, Math.max(min, width - SIDEBAR_MAIN_RESERVE)),
  };
}

export function getWorkbenchBoundsForViewport(viewportWidth: number, sidebarWidth: number): WidthBounds {
  const width = Number.isFinite(viewportWidth) ? viewportWidth : 1440;
  const sidebar = Number.isFinite(sidebarWidth) ? Math.max(0, sidebarWidth) : 0;
  return {
    min: WORKBENCH_MIN,
    max: Math.min(WORKBENCH_MAX, Math.max(WORKBENCH_MIN, width - sidebar - WORKBENCH_CONVERSATION_MIN)),
  };
}

export function loadPanelWidth(
  storage: Pick<Storage, "getItem">,
  key: string,
  fallback: number,
): number {
  const raw = storage.getItem(STORAGE_PREFIX + key);
  if (!raw) return fallback;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function savePanelWidth(
  storage: Pick<Storage, "setItem">,
  key: string,
  width: number,
): void {
  storage.setItem(STORAGE_PREFIX + key, String(Math.round(width)));
}
