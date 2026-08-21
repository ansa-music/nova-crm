import { useEffect, useRef, useState } from "react";

/**
 * Animates numeric transitions (money totals, counts) over ~500ms using an
 * ease-out curve. Renders the RAW target value on first mount (nothing to
 * animate from yet) and only tweens on subsequent changes.
 */
export function useAnimatedNumber(target: number, duration = 500): number {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);
  const rafRef = useRef<number | undefined>(undefined);
  const mountedRef = useRef(false);

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      fromRef.current = target;
      setValue(target);
      return;
    }
    const from = fromRef.current;
    const delta = target - from;
    if (delta === 0) return;
    const start = performance.now();

    function tick(now: number) {
      const elapsed = now - start;
      const progress = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(from + delta * eased);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = target;
      }
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  return value;
}
