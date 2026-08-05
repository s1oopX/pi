import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  clampWidth,
  loadPanelWidth,
  resolveKeyboardPanelWidth,
  resolvePanelWidth,
  savePanelWidth,
  type ResizeEdge,
  type WidthBounds,
} from "../lib/panelSizing";

interface PanelResizeOptions {
  /** Persistence key; also the identity of the panel. */
  storageKey: string;
  /** Default width when nothing is stored. */
  defaultWidth: number;
  bounds: WidthBounds;
  /** Raw dragged width below this collapses the panel on release. */
  collapseAt: number;
  /** Which edge carries the handle. "right" grows as the pointer moves right
   * (left sidebar); "left" grows as the pointer moves left (right workbench). */
  edge: ResizeEdge;
  /** Fired once when a drag ends past the collapse threshold. */
  onCollapse: () => void;
  /** When true, the panel is collapsed and reports no width. */
  collapsed?: boolean;
}

interface PanelResizeState {
  /** Current committed width, or null while collapsed. */
  width: number | null;
  /** True mid-drag, for cursor/overlay styling. */
  dragging: boolean;
  /** True mid-drag while past the collapse threshold. */
  willCollapse: boolean;
  /** Attach to the drag handle element. */
  onHandlePointerDown: (event: ReactPointerEvent) => void;
  /** Attach to the drag handle element for keyboard resizing. */
  onHandleKeyDown: (event: ReactKeyboardEvent) => void;
}

export function usePanelResize(options: PanelResizeOptions): PanelResizeState {
  const { storageKey, defaultWidth, bounds, collapseAt, edge, onCollapse, collapsed } = options;
  const [width, setWidth] = useState(() => loadStoredPanelWidth(storageKey, defaultWidth, bounds));
  const [dragging, setDragging] = useState(false);
  const [willCollapse, setWillCollapse] = useState(false);
  // Latest values captured for the pointer handlers, avoiding stale closures.
  const dragRef = useRef({ bounds, collapseAt, edge, onCollapse });
  dragRef.current = { bounds, collapseAt, edge, onCollapse };

  const onHandlePointerDown = useCallback(
    (event: ReactPointerEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = width;
      setDragging(true);

      const handleMove = (moveEvent: PointerEvent) => {
        const delta = moveEvent.clientX - startX;
        const raw = dragRef.current.edge === "right" ? startWidth + delta : startWidth - delta;
        const resolved = resolvePanelWidth(raw, dragRef.current.bounds, dragRef.current.collapseAt);
        setWillCollapse(resolved.collapse);
        setWidth(resolved.width);
      };

      function stopListening(): void {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
        window.removeEventListener("pointercancel", handleCancel);
      }

      function handleCancel(): void {
        stopListening();
        setDragging(false);
        setWillCollapse(false);
        setWidth(startWidth);
      }

      function handleUp(upEvent: PointerEvent): void {
        stopListening();
        setDragging(false);
        setWillCollapse(false);
        const delta = upEvent.clientX - startX;
        const raw = dragRef.current.edge === "right" ? startWidth + delta : startWidth - delta;
        const resolved = resolvePanelWidth(raw, dragRef.current.bounds, dragRef.current.collapseAt);
        if (resolved.collapse) {
          // Keep the clamped width stored so the panel restores to a sane size.
          saveStoredPanelWidth(storageKey, resolved.width);
          setWidth(resolved.width);
          dragRef.current.onCollapse();
          return;
        }
        setWidth(resolved.width);
        saveStoredPanelWidth(storageKey, resolved.width);
      }

      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
      window.addEventListener("pointercancel", handleCancel);
    },
    [storageKey, width],
  );

  const onHandleKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      const nextWidth = resolveKeyboardPanelWidth(
        event.key,
        event.shiftKey,
        width,
        dragRef.current.bounds,
        dragRef.current.edge,
      );
      if (nextWidth === null) return;
      event.preventDefault();
      setWidth(nextWidth);
      saveStoredPanelWidth(storageKey, nextWidth);
    },
    [storageKey, width],
  );

  // Re-clamp when bounds shrink (e.g. window resize) so a stored width never
  // exceeds the current viewport-derived maximum.
  useEffect(() => {
    setWidth((current) => clampWidth(current, bounds));
  }, [bounds]);

  return {
    width: collapsed ? null : width,
    dragging,
    willCollapse,
    onHandlePointerDown,
    onHandleKeyDown,
  };
}

function loadStoredPanelWidth(storageKey: string, defaultWidth: number, bounds: WidthBounds): number {
  if (typeof window === "undefined") return clampWidth(defaultWidth, bounds);
  try {
    return clampWidth(loadPanelWidth(window.localStorage, storageKey, defaultWidth), bounds);
  } catch {
    return clampWidth(defaultWidth, bounds);
  }
}

function saveStoredPanelWidth(storageKey: string, width: number): void {
  if (typeof window === "undefined") return;
  try {
    savePanelWidth(window.localStorage, storageKey, width);
  } catch {}
}
