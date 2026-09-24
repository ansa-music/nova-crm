import { useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace } from "@/hooks/useWorkspace";
import { osNickLabel } from "@/services/memberService";
import type { OsDeskKeys } from "@/services/osDeskService";
import { sendOsRowToExchange } from "@/services/rows/osExchange";
import { DEFAULT_STATUS_OPTIONS, ensureApprovalStatus, ensureDoneStatus } from "@/utils/columnOptions";
import { myDisplayName } from "@/utils/displayName";
import { worksAsTechnician } from "@/utils/peopleDesks";
import type { PageRow, WorkOrder, WorkOrderUrgency } from "@/types";

/**
 * «Отдать в работу» со стола ОС: заказ уходит на «Заказы» сразу со всеми
 * данными строки (клиент, номер, цена + апсейл, ссылка, визитка). Одна
 * функция на кнопку в таблице и на «Общий» в диалоге «Как отдать заказ?» —
 * две копии разошлись бы в первом же исправлении.
 */
export function useSendOsRowToExchange() {
  const { profile } = useAuth();
  const { activeWorkspaceId, activeWorkspace, members } = useWorkspace();

  return useCallback(
    async (input: { row: PageRow; pageId: string; tabId: string | null; keys?: OsDeskKeys; urgency?: WorkOrderUrgency }): Promise<WorkOrder> => {
      if (!activeWorkspaceId || !profile) throw new Error("Нет входа в workspace");
      const me = members.find((m) => m.uid === profile.uid);
      const osValue = me?.osNickValue ?? "";
      return sendOsRowToExchange({
        workspaceId: activeWorkspaceId,
        pageId: input.pageId,
        tabId: input.tabId,
        row: input.row,
        keys: input.keys,
        urgency: input.urgency,
        me: { uid: profile.uid, name: myDisplayName(profile, members) },
        osValue,
        osLabel: osNickLabel(me, activeWorkspace?.responsibleOptions) ?? osValue,
        technicianUids: members.filter((m) => m.status === "active" && m.uid && worksAsTechnician(m)).map((m) => m.uid),
        statusOptions: ensureApprovalStatus(ensureDoneStatus(activeWorkspace?.statusOptions ?? DEFAULT_STATUS_OPTIONS)),
      });
    },
    [activeWorkspaceId, activeWorkspace, members, profile]
  );
}
