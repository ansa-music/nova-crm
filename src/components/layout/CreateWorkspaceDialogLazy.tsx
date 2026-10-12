import { lazy, Suspense, useState } from "react";

const Impl = lazy(() =>
  import("@/components/layout/CreateWorkspaceDialog").then((m) => ({ default: m.CreateWorkspaceDialog }))
);

/** «Создать workspace» с отложенной загрузкой — см. `CreatePageDialogLazy`: тот же приём и та же причина. */
export function CreateWorkspaceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [wanted, setWanted] = useState(open);
  if (open && !wanted) setWanted(true);
  if (!wanted) return null;
  return (
    <Suspense fallback={null}>
      <Impl open={open} onOpenChange={onOpenChange} />
    </Suspense>
  );
}
