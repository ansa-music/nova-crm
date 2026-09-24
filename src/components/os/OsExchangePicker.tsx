import { useState } from "react";
import { AssignOrderDialog } from "@/components/orders/AssignOrderDialog";
import { RandomWheelDialog, type WheelCandidate } from "@/components/orders/RandomWheelDialog";
import { toast } from "@/components/ui/sonner";
import { useAuth } from "@/hooks/useAuth";
import { useOrderAssignment } from "@/hooks/useOrderAssignment";
import { useWorkspace } from "@/hooks/useWorkspace";
import { assignOrder, type OrderCandidate } from "@/services/orderService";
import { myDisplayName } from "@/utils/displayName";
import type { WorkOrder } from "@/types";

/**
 * «Кому отдать» прямо со стола ОС (просьба Nurba 24.09.2026: «выдача со
 * стола на общее — чтобы откликались, а потом выбрать технаря»). Тот же диалог,
 * те же кандидаты, отклики, занятость и «Рандом» с барабаном, что на
 * «Заказах» (`useOrderAssignment`), — только открывается из ячейки «Технарь».
 *
 * Выдача — обычный `assignOrder`: дальше заказ везёт к технарю сессия ОС
 * (`useOsExchangeHandoff`), как если бы его отдали на «Заказах».
 * `order` — ЖИВОЙ снимок (из подписки стола): отклики, пришедшие уже после
 * открытия окна, видны сразу, и «Рандом» тянет из них.
 */
export function OsExchangePicker({ order, onClose }: { order: WorkOrder | null; onClose: () => void }) {
  const { profile } = useAuth();
  const { activeWorkspaceId, members } = useWorkspace();
  const assignment = useOrderAssignment(Boolean(order));
  const [wheel, setWheel] = useState<{ order: WorkOrder; pool: WheelCandidate[]; winner: OrderCandidate } | null>(null);
  const myName = myDisplayName(profile, members);

  async function assign(target: WorkOrder, candidate: OrderCandidate, silent = false) {
    if (!activeWorkspaceId || !profile) throw new Error("Нет входа в workspace");
    await assignOrder({
      workspaceId: activeWorkspaceId,
      order: target,
      technician: { uid: candidate.uid, name: candidate.name },
      actorUid: profile.uid,
      actorName: myName,
    });
    if (!silent) {
      toast.success(`«${target.client}» — ${candidate.name}`, {
        description: "Заказ едет в его стол: у вас в строке появится ник технаря.",
      });
    }
  }

  return (
    <>
      <AssignOrderDialog
        order={wheel ? null : order}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        candidates={order ? assignment.candidatesFor(order) : []}
        onAssign={async (candidate) => {
          if (order) await assign(order, candidate);
        }}
        onRandom={async () => {
          if (!order) return;
          const draw = assignment.drawRandom(order);
          if (!draw.ok) throw new Error(draw.reason);
          setWheel({ order, pool: draw.pool, winner: draw.winner });
        }}
      />
      <RandomWheelDialog
        pool={wheel?.pool ?? []}
        winnerUid={wheel?.winner.uid ?? null}
        orderClient={wheel?.order.client ?? ""}
        onAssign={async () => {
          if (wheel) await assign(wheel.order, wheel.winner, true);
        }}
        onClose={() => {
          setWheel(null);
          onClose();
        }}
      />
    </>
  );
}
