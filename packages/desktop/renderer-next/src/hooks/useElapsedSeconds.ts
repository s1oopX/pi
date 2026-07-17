import { useEffect, useRef, useState } from "react";

/** Tick elapsed whole seconds while `active` is true; resets when inactive. */
export function useElapsedSeconds(active: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef<number | null>(null);

  useEffect(() => {
    if (!active) {
      startedAt.current = null;
      setElapsed(0);
      return;
    }

    startedAt.current = Date.now();
    setElapsed(0);
    const timer = setInterval(() => {
      if (startedAt.current != null) {
        setElapsed(Math.floor((Date.now() - startedAt.current) / 1000));
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [active]);

  return elapsed;
}
