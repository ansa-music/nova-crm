import { lazy, Suspense, useEffect, useState } from "react";

const MiniGame = lazy(() => import("@/components/common/MiniGame"));

/** Событие «открыть игру» — его шлют кнопка верхней панели и плитка в листе «Ещё» телефона. */
export const MINIGAME_EVENT = "nova:minigame";

export function openMiniGame() {
  window.dispatchEvent(new Event(MINIGAME_EVENT));
}

/**
 * Окно игры живёт в каркасе, а не в кнопке, которая его открыла: лист «Ещё» на
 * телефоне закрывается при нажатии на плитку, и окно, смонтированное внутри
 * него, закрылось бы вместе с ним. Сама игра грузится только по первому открытию.
 */
export function MiniGameHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(MINIGAME_EVENT, onOpen);
    return () => window.removeEventListener(MINIGAME_EVENT, onOpen);
  }, []);
  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <MiniGame open onOpenChange={setOpen} />
    </Suspense>
  );
}
