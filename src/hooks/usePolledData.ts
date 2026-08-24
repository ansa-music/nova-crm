import { useCallback, useEffect, useRef, useState } from "react";

export const SPARK_POLL_MS = 60_000;

/**
 * One-shot getDocs plus an infrequent poll while the tab is visible.
 * Never opens an onSnapshot — used for screens that do not need live data.
 */
export function usePolledData<T>(
  enabled: boolean,
  load: () => Promise<T>,
  initial: T,
  deps: unknown[]
) {
  const [data, setData] = useState<T>(initial);
  const [isLoading, setIsLoading] = useState(Boolean(enabled));
  const loadRef = useRef(load);
  loadRef.current = load;
  const initialRef = useRef(initial);
  initialRef.current = initial;

  const run = useCallback(async () => {
    if (!enabled) return;
    try {
      const next = await loadRef.current();
      setData(next);
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setData(initialRef.current);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    void run();

    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void run();
    }, SPARK_POLL_MS);

    function onVis() {
      if (document.visibilityState === "visible") void run();
    }
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, run, ...deps]);

  return { data, isLoading, reload: run };
}
