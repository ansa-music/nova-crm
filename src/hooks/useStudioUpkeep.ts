import { useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router";
import { toast } from "@/components/ui/sonner";
import { useStudioSaved } from "@/config/studio";
import { useCorePagesBackend } from "@/services/coreStore";
import { sbBackendOf } from "@/services/sb/sbCollections";
import { useTgServerConnected } from "@/services/telegram/tgServer";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useBootstrapStore } from "@/store/bootstrapStore";
import { memberHasRole, type WorkspaceMember } from "@/types";
import { deskHref } from "@/utils/deskLinks";
import { myDisplayName } from "@/utils/displayName";

/**
 * Обслуживание воркспейса «NOVA Studio» из сессии участника. Без сохранённого
 * флага студии (`useStudioSaved` — не черновик Конструктора) хук ничего не
 * читает и ничего не пишет; код записи грузится `import()` только в студии.
 *
 * (а) Свой стол менеджера — заводит ЕГО сессия (критика team-ux I0): квоту
 *     «один стол» держит сервер, колонки — шаблон студии, имя «Стол {ник}».
 *     Не заводим, пока ядро переносится в Supabase (критика isolation B3:
 *     стол, записанный в Firestore между чтением и отметкой переноса, не
 *     доехал бы, и следующий заход завёл бы второй), пока у человека есть
 *     любой стол (и «Неактуальный» тоже) и пока данные workspace не пришли.
 * (б) Сессия Owner: общий Telegram у всех активных участников — только
 *     ДОБАВИТЬ (ensureStudioTelegramAccess), при загрузке, при смене состава
 *     и при подключении общего аккаунта (с паузой), только по полному ростеру
 *     из двух и больше человек и только когда аккаунт подключён.
 */

/** Стол — не сразу после загрузки: снимок столов мог прийти из кэша. */
const DESK_DELAY_MS = 3_000;
/** Состав участников меняется пачкой снимков — сверка Telegram одна на серию. */
const TG_DEBOUNCE_MS = 2_500;

/** Раз за загрузку: стол — на «workspace:человек», Telegram — последний УСПЕШНО сверенный состав. */
const deskTried = new Set<string>();
const tgChecked = new Map<string, string>();

function activeUidsSig(members: WorkspaceMember[]): string {
  const uids = new Set<string>();
  for (const m of members) if (m.status === "active" && m.uid) uids.add(m.uid);
  return [...uids].sort().join(",");
}

export function useStudioUpkeep() {
  const studio = useStudioSaved();
  const permissions = usePermissions();
  const { profile } = useAuth();
  const { activeWorkspace, activeWorkspaceId, members, allPages, membersLoadState } = useWorkspace();
  const resolvedId = useBootstrapStore((s) => s.resolvedDataWorkspaceId);
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  const uid = profile?.uid ?? "";
  // Данные ИМЕННО этого workspace загружены и права известны (на кадре
  // переключения workspace isResolved ещё ложь — resolvedDataWorkspaceId отстаёт).
  const on = Boolean(studio && permissions.isResolved && uid && activeWorkspaceId && resolvedId === activeWorkspaceId);

  // ---- (а) свой стол менеджера ----
  const me = on ? members.find((m) => m.uid === uid) : undefined;
  const deskWanted = Boolean(
    on && me && me.status === "active" && memberHasRole(me, "manager") && me.role !== "owner" && activeWorkspace?.ownerId !== uid
  );
  const hasOwnDesk = deskWanted && allPages.some((p) => p.responsibleUserId === uid);
  // Хранилище столов спрашиваем только когда стол нужен — у остальных ни одного запроса.
  const coreBackend = useCorePagesBackend(deskWanted ? activeWorkspaceId : null);
  const corePending = Boolean(
    deskWanted &&
      activeWorkspace?.rowsBackend === "supabase" &&
      sbBackendOf(activeWorkspace, "core") === "supabase" &&
      coreBackend !== "supabase"
  );
  const deskDue = deskWanted && !hasOwnDesk && !corePending;

  const latestRef = useRef({ profile, members, allPages });
  latestRef.current = { profile, members, allPages };

  useEffect(() => {
    if (!deskDue || !activeWorkspaceId || !uid) return;
    const ws = activeWorkspaceId;
    const key = `${ws}:${uid}`;
    if (deskTried.has(key)) return;
    const timer = window.setTimeout(() => {
      if (deskTried.has(key)) return;
      const latest = latestRef.current;
      if (latest.allPages.some((p) => p.responsibleUserId === uid)) return;
      deskTried.add(key);
      const nick = myDisplayName(latest.profile, latest.members);
      const order = latest.allPages.length;
      void import("@/services/studioService")
        .then((studioService) =>
          studioService.runWithStudioLock(
            `nova-studio-desk:${ws}:${uid}`,
            () => studioService.ensureStudioOwnDesk({ workspaceId: ws, uid, nick, order }),
            { ifAvailable: true }
          )
        )
        .then((page) => {
          if (!page) return;
          toast.success(`Ваш стол «${page.name}» готов`, {
            description: "Заказы ведите в нём — его видите вы и Owner.",
            action: { label: "Открыть", onClick: () => navigateRef.current(deskHref(page.id)) },
          });
        })
        .catch((error: unknown) => console.warn("[studio] свой стол менеджера не заведён", error));
    }, DESK_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [deskDue, activeWorkspaceId, uid]);

  // ---- (б) общий Telegram у всех — сессия Owner ----
  const tgOwner = Boolean(on && permissions.upkeepOwner);
  // Статус общего аккаунта — общий стор (тот же у «Telegram» и фоновой
  // части): подключение по QR будит его, и сверка идёт без перезагрузки
  // (ревью C3). Подписка — только в студии и только у Owner.
  const tgConnected = useTgServerConnected(tgOwner ? activeWorkspaceId : null, tgOwner);
  const tgOn = Boolean(tgOwner && membersLoadState === "ready");
  const rosterSig = useMemo(() => (tgOn ? activeUidsSig(members) : ""), [tgOn, members]);

  useEffect(() => {
    if (!rosterSig || !activeWorkspaceId || !tgConnected) return;
    const uids = rosterSig.split(",");
    // Один человек — ростер ещё не полный (снимок своей записи раньше списка) или звать некого.
    if (uids.length < 2) return;
    const ws = activeWorkspaceId;
    if (tgChecked.get(ws) === rosterSig) return;
    const timer = window.setTimeout(() => {
      void import("@/services/studioService")
        .then((studioService) => studioService.ensureStudioTelegramAccess(ws, uids))
        .then((result) => {
          // «Сверено» — только по ответу. null (аккаунт ещё не подключён на
          // сервере, нет SQL, сбой статуса) и ошибка — повтор при следующем
          // подключении, смене состава или загрузке.
          if (!result) return;
          tgChecked.set(ws, rosterSig);
          if (result.added.length > 0) console.info(`[studio] доступ к общему Telegram выдан: ${result.added.length}`);
        })
        .catch((error: unknown) => console.warn("[studio] сверка доступа к Telegram не удалась", error));
    }, TG_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [rosterSig, activeWorkspaceId, tgConnected]);
}
