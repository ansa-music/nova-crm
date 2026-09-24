import { useEffect, type ReactNode } from "react";
import { useLocation } from "react-router";
import { usePageMeta } from "@/hooks/useNavModel";

/**
 * Обёртка экрана внутри <main>. Появление нового экрана — CSS-анимация
 * `.page-enter` (index.css): только opacity, 150 мс, только на ПК с мышью.
 *
 * Раньше здесь был GSAP-твин opacity + y + scale на 300 мс. Он оставлял на
 * обёртке inline `transform`, а transform делает элемент containing block для
 * `position: fixed` потомков и отдельным stacking context: fixed-оверлеи
 * внутри main (RowCardSheet рисуется без портала) позиционировались от
 * обёртки, а не от окна. Поэтому здесь НИКАКОГО transform — ни в анимации,
 * ни после неё (fill-mode none: по окончании стилей анимации не остаётся).
 * И сам GSAP (≈69 КБ в стартовом chunk) ради одного fade был не нужен.
 *
 * `key` по пути: новый экран — новая обёртка, и анимация стартует сама, без
 * принудительного reflow. Поддерево и так пересоздаётся при смене пути
 * (ErrorBoundary в AppLayout — с тем же ключом), так что лишней работы нет.
 */
export function PageShell({ children }: { children: ReactNode }) {
  const location = useLocation();
  const meta = usePageMeta(location.pathname);

  // Вкладка браузера подписана разделом — из той же модели, что шапка
  // телефона; имя стола подтягивается, когда список столов доехал.
  useEffect(() => {
    document.title = `${meta.title} · Nova`;
  }, [meta.title]);

  return (
    <div key={location.pathname} className="page-enter flex h-full min-h-0 flex-col">
      {children}
    </div>
  );
}
