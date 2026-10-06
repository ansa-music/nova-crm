import { Component, lazy, Suspense, useSyncExternalStore, type ReactNode } from "react";
import { currentSiteConfig, subscribeSiteConfig } from "@/config/siteTerms";
import { isCosmosSite } from "@/config/studio";

/**
 * Фон «мифический космос» (воркспейс «NOVA Studio», 06.10.2026) — гейт.
 *
 * Монтируется первым ребёнком корня каркаса (`AppChrome`) и сам читает
 * настройку сайта: нет `theme.fx === "cosmos"` — `null`, и тяжёлая часть
 * (`CosmosBackdrop`, свой ленивый chunk) у других компаний не качается вовсе.
 * Флаг берётся с черновиком Конструктора — это только вид (предпросмотр).
 * Подписка — на ОДИН признак: перерисовка только когда он сменился.
 */
const CosmosBackdrop = lazy(() => import("./CosmosBackdrop"));

const cosmosSnapshot = (): boolean => isCosmosSite(currentSiteConfig());

export function CosmosBackdropHost() {
  const cosmos = useSyncExternalStore(subscribeSiteConfig, cosmosSnapshot, cosmosSnapshot);
  if (!cosmos) return null;
  return (
    <SilentBoundary>
      <Suspense fallback={null}>
        <CosmosBackdrop />
      </Suspense>
    </SilentBoundary>
  );
}

/**
 * Не догрузился chunk фона (деплой, сеть) — без фона, но с каркасом: ошибка
 * ленивого импорта иначе дошла бы до корня и уронила весь экран. Перезагрузку
 * после деплоя по `vite:preloadError` решает useAppUpdateCheck, не мы.
 */
class SilentBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.warn("[cosmos] фон не загрузился", error);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
