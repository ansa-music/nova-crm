import { useEffect, useState } from "react";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(query).matches : false
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = () => setMatches(mql.matches);
    handler();
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [query]);

  return matches;
}

export const useIsMobile = () => useMediaQuery("(max-width: 767px)");
export const useIsTablet = () => useMediaQuery("(max-width: 1023px)");
/**
 * Есть ли у устройства настоящее наведение (мышь/трекпад). Ширина экрана
 * тут не годится: iPad в альбоме шире 1024px, но наведения у него нет.
 * `matchMedia` реагирует и на подключение мыши к планшету.
 */
export const useCanHover = () => useMediaQuery("(hover: hover) and (pointer: fine)");
