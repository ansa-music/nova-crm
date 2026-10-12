import { lazy, Suspense, useState } from "react";

const Impl = lazy(() => import("@/components/pagesnav/CreatePageDialog").then((m) => ({ default: m.CreatePageDialog })));

/**
 * «Новый стол» с отложенной загрузкой. Окно смонтировано в каркасе всегда
 * (AppLayout, боковое меню, палитра), а открывают его редко — при этом оно
 * тянуло в стартовый набор react-hook-form и zod у каждого при входе. Теперь
 * код окна качается при первом открытии; после этого окно остаётся
 * смонтированным, как раньше (закрытие доигрывает свою анимацию).
 */
export function CreatePageDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [wanted, setWanted] = useState(open);
  if (open && !wanted) setWanted(true);
  if (!wanted) return null;
  return (
    <Suspense fallback={null}>
      <Impl open={open} onOpenChange={onOpenChange} />
    </Suspense>
  );
}
