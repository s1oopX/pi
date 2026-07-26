/**
 * Roving-focus index math shared by the sidebar's menus and row lists
 * (ARIA menu/listbox keyboard pattern: arrows wrap, Home/End jump).
 * Returns null for keys the pattern does not handle.
 */
export function nextRovingIndex(count: number, currentIndex: number, key: string): number | null {
  if (count <= 0) return null;
  switch (key) {
    case "Home":
      return 0;
    case "End":
      return count - 1;
    case "ArrowDown":
      return (currentIndex + 1 + count) % count;
    case "ArrowUp":
      return (currentIndex - 1 + count) % count;
    default:
      return null;
  }
}
