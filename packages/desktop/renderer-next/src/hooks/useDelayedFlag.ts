import { useEffect, useState } from "react";

/** Returns true only once `active` has stayed true for at least `delayMs`.
 * Flipping `active` back to false resets immediately. Use to suppress
 * flash-of-spinner on fast operations: a short-lived load never crosses the
 * threshold, so nothing is shown. */
export function useDelayedFlag(active: boolean, delayMs: number): boolean {
  const [elapsed, setElapsed] = useState(false);

  useEffect(() => {
    if (!active) {
      setElapsed(false);
      return;
    }
    const timer = window.setTimeout(() => setElapsed(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [active, delayMs]);

  return active && elapsed;
}
