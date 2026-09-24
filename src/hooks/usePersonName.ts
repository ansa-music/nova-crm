import { useCallback, useMemo } from "react";
import { useWorkspace } from "@/hooks/useWorkspace";
import { displayNameOf } from "@/utils/displayName";

/**
 * Подпись человека по uid — ПО НИКУ, как сейчас (просьба Nurba 25.09.2026:
 * «всегда отображение по нику везде и у всех»). Имена в сообщениях,
 * уведомлениях, заказах, истории и «обновил(а)» записаны строкой в момент
 * действия — старым полным именем или старым ником. Там, где рядом есть uid,
 * показываем живую подпись участника; не участник (ушёл) — сохранённую строку.
 */
export function usePersonName(): (uid: string | null | undefined, fallback?: string | null) => string {
  const { members } = useWorkspace();
  const byUid = useMemo(() => new Map(members.map((m) => [m.uid, m])), [members]);
  return useCallback(
    (uid, fallback) => {
      const member = uid ? byUid.get(uid) : undefined;
      if (member) return displayNameOf(member);
      return fallback?.trim() || "—";
    },
    [byUid]
  );
}
