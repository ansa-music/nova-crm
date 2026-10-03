import { useEffect, useMemo, useRef, useState } from "react";
import { RandomWheelDialog, type WheelCandidate } from "@/components/orders/RandomWheelDialog";
import { useSiteConfig } from "@/config/siteTerms";
import { useWorkspace } from "@/hooks/useWorkspace";
import { fetchLatestSpin, isOwnSpin, WHEEL_FRESH_MS, WHEEL_TOPIC, type LiveSpin } from "@/services/randomService";
import { listenTopic } from "@/services/sb/topicDoorbell";
import { isModuleEnabled } from "@/types/siteConfig";
import { displayNameOf } from "@/utils/displayName";

/**
 * Барабан «Рандома» у всех, кто СЕЙЧАС на сайте (просьба Nurba 03.10.2026:
 * «при прокрутке рулетки все видят эту рулетку, если на сайте; если не на
 * сайте — не видят, чтобы вечером не крутилась чужая рулетка»).
 *
 * Тот, кто крутит, звонит в `nova:{ws}:wheel` (звонок без данных). Открытая
 * ВИДИМАЯ вкладка по звонку спрашивает последний спин и показывает его, только
 * если ему меньше 15 секунд по часам базы. Звонок не хранится: закрытый сайт
 * и свёрнутая вкладка ничего не догоняют. Свой спин эта вкладка уже крутит
 * сама. Одно окно на приложение (AppLayout).
 */
export function LiveWheelHost() {
  const { activeWorkspaceId, members } = useWorkspace();
  const ordersOn = isModuleEnabled(useSiteConfig(), "orders");
  const [spin, setSpin] = useState<LiveSpin | null>(null);
  const seen = useRef(new Set<string>());

  useEffect(() => {
    if (!activeWorkspaceId || !ordersOn) return;
    const ws = activeWorkspaceId;
    let alive = true;
    const stop = listenTopic(WHEEL_TOPIC(ws), () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      void fetchLatestSpin(ws).then((next) => {
        if (!alive || !next) return;
        if (next.ageMs > WHEEL_FRESH_MS || isOwnSpin(next.id) || seen.current.has(next.id)) return;
        seen.current.add(next.id);
        setSpin((current) => current ?? next);
      });
    });
    return () => {
      alive = false;
      stop();
      setSpin(null);
    };
  }, [activeWorkspaceId, ordersOn]);

  const pool = useMemo<WheelCandidate[]>(() => {
    if (!spin) return [];
    const byUid = new Map(members.map((m) => [m.uid, m]));
    return spin.pool.map((p) => {
      const member = byUid.get(p.uid) ?? null;
      return {
        uid: p.uid,
        name: member ? displayNameOf(member) : p.name || "—",
        hasDesk: true,
        claimedAt: null,
        blockedReason: null,
        absentToday: false,
        member,
      };
    });
  }, [spin, members]);

  const byName = useMemo(() => {
    if (!spin) return "";
    const member = spin.byUid ? members.find((m) => m.uid === spin.byUid) : null;
    return member ? displayNameOf(member) : spin.byName;
  }, [spin, members]);

  return (
    <RandomWheelDialog
      key={spin?.id ?? "none"}
      pool={pool}
      winnerUid={spin?.winnerUid ?? null}
      orderClient={spin?.title || "Заказ"}
      watch={spin ? { byName } : null}
      onClose={() => setSpin(null)}
    />
  );
}
