import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import {
  beatFirestore,
  beatSupabase,
  notePresenceLanded,
  presenceBackendOf,
} from "@/services/presenceService";
import { useBootstrapStore } from "@/store/bootstrapStore";
import { useWorkspaceStore } from "@/store/workspaceStore";

/**
 * Таймер вкладки — раз в 5 минут. Сам удар идёт в Supabase
 * (`member_presence`, без суточной квоты), поэтому чаще прежних 15 минут
 * можно: «в сети» точнее, а Firestore не тратит ничего. Пока Supabase-путь
 * недоступен (SQL не накатан, строки в Firestore, откат флагом), в Firestore
 * по-прежнему пишется не чаще раза в 12 минут — см. FS_BEAT_MIN_GAP_MS.
 */
const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Минимальный промежуток между ударами в Supabase — общий на ВСЕ вкладки
 * человека. Меньше шага таймера (4 < 5), чтобы собственный таймер вкладки
 * всегда проходил, а лишние вкладки, монтаж и visibilitychange — нет.
 */
const SB_BEAT_MIN_GAP_MS = 4 * 60 * 1000;

/**
 * То же для запасного пути в Firestore — прежние 12 минут: каждый удар там —
 * запись в member-документ КАЖДОГО workspace человека плюс снимок own-member
 * у всех его вкладок, а квота Spark — 20 000 записей в сутки. С таймером в 5
 * минут удар в Firestore выходит раз в 15 минут, как и раньше.
 */
const FS_BEAT_MIN_GAP_MS = 12 * 60 * 1000;

/**
 * Ключ Firestore-ворот — ПРЕЖНИЙ (`nova:beat:{uid}`): им же пользуются
 * вкладки на старом коде, и общий штамп не даёт им писать поверх нашего
 * запасного удара. Ключ Supabase — отдельный: удар в Supabase не должен
 * глушить Firestore-пульс старой вкладки — её зрители на старом коде
 * смотрят только в Firestore.
 */
function fsStampKey(uid: string) {
  return `nova:beat:${uid}`;
}

/**
 * «Не повторять до» после НЕУДАВШЕГОСЯ удара в Firestore — свой ключ, не
 * `nova:beat`: неудачу нельзя выдавать старым вкладкам за удар, иначе они
 * тоже замолчали бы. Зачем он вообще: workspace, откуда человека убрали
 * другие, остаётся в `profile.workspaceIds` (убирает только он сам), его
 * документ по-прежнему читается, и запись туда отклоняется всегда. Без этой
 * отметки отказ повторялся бы на КАЖДОМ такте таймера (5 минут) в каждой
 * вкладке; с ней — раз в 15 минут, как до переноса пульса. Отказ квоты
 * (resource-exhausted) повторяется так же, как и раньше, — раз в 15 минут.
 */
function fsRetryKey(uid: string) {
  return `nova:beat-retry:${uid}`;
}

function sbStampKey(uid: string) {
  return `nova:beat-sb:${uid}`;
}

/**
 * Запасной штамп внутри вкладки — на случай, когда localStorage недоступен
 * (приватный режим, запрет данных сайта): тогда общие на вкладки ворота
 * теряются, но внутри вкладки пульс всё равно не чаще порога.
 */
const tabStamps = new Map<string, number>();

/** Удар, начатый этой вкладкой и ещё не подтверждённый сервером — второй поверх него не нужен. */
const beatInFlight = new Set<string>();

function readStamp(key: string): number {
  let shared = 0;
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? Number(raw) : 0;
    if (Number.isFinite(parsed)) shared = parsed;
  } catch {
    /* хранилище закрыто — остаётся штамп вкладки */
  }
  return Math.max(shared, tabStamps.get(key) ?? 0);
}

function writeStamp(key: string, at: number) {
  tabStamps.set(key, at);
  try {
    window.localStorage.setItem(key, String(at));
  } catch {
    /* без хранилища — только ворота внутри вкладки */
  }
}

function stampDue(key: string, gapMs: number, now: number): boolean {
  const age = now - readStamp(key);
  // Штамп «из будущего» (перевели часы назад) не должен глушить пульс
  // до тех пор, пока часы его не догонят, — считаем его устаревшим.
  return age < 0 || age >= gapMs;
}

/** Mount once near the app root (inside AppLayout). Keeps this user's presence fresh across all their workspaces. */
export function usePresenceHeartbeat() {
  const { profile } = useAuth();
  const uid = profile?.uid;
  const workspaceIds = profile?.workspaceIds;
  // Куда писать, решает документ КАЖДОГО workspace (rowsBackend и флаг).
  // Документы всех workspace человека вкладка держит живыми
  // (useWorkspaceListBootstrap → subscribeToUserWorkspaces), поэтому решение
  // принимается по каждому, а не только по текущему. Пока список не пришёл,
  // удар ждёт: иначе каждая загрузка успевала бы потратить запись Firestore
  // до того, как узнала, что можно было в Supabase. Эти значения здесь —
  // только повод ударить сразу, как документы пришли или флаг сменился;
  // решает сам удар (ниже) по состоянию хранилища на момент удара.
  const listResolved = useBootstrapStore((s) => s.workspaceListResolved);
  const workspacesSignature = useWorkspaceStore((s) =>
    s.workspaces.map((w) => `${w.id}:${w.rowsBackend ?? ""}:${w.sbCollections?.presence ?? ""}`).join("|")
  );

  useEffect(() => {
    if (!uid || !workspaceIds?.length) return;
    const me = uid;
    const ids = workspaceIds;

    function beat() {
      if (document.visibilityState !== "visible") return;
      if (beatInFlight.has(me)) return;
      // Список workspace ещё не пришёл — не знаем, куда писать; ударим, как
      // придёт (listResolved в зависимостях эффекта).
      if (!useBootstrapStore.getState().workspaceListResolved) return;

      // Решение — на момент удара, а не отрисовки: память «таблицы нет»
      // (sbCollections) истекает сама, без перерисовки AppLayout.
      const docs = new Map(useWorkspaceStore.getState().workspaces.map((w) => [w.id, w]));
      const sbIds: string[] = [];
      const fsIds: string[] = [];
      for (const ws of ids) {
        const doc = docs.get(ws);
        // Документа нет в пришедшем списке — workspace удалён или id
        // устарел (subscribeToUserWorkspaces такие отбрасывает). Писать
        // туда незачем: запись всё равно отклонят. Новый workspace, чей
        // документ ещё в пути, получит удар на следующем такте.
        if (!doc) continue;
        if (presenceBackendOf(doc) === "supabase") sbIds.push(ws);
        else fsIds.push(ws);
      }
      const now = Date.now();
      // Все Supabase-workspace — ОДНИМ вызовом: тогда общий на вкладки штамп
      // `nova:beat-sb` покрывает их все, и удар одной вкладки не срезает
      // удар по workspace, который открыт в другой.
      const sbDue = sbIds.length > 0 && stampDue(sbStampKey(me), SB_BEAT_MIN_GAP_MS, now);
      const fsDue = () =>
        stampDue(fsStampKey(me), FS_BEAT_MIN_GAP_MS, now) && stampDue(fsRetryKey(me), FS_BEAT_MIN_GAP_MS, now);
      if (!sbDue && !(fsIds.length > 0 && fsDue())) return;

      beatInFlight.add(me);
      void (async () => {
        let fsList = fsIds;
        if (sbDue) {
          const { landed, rest } = await beatSupabase(sbIds);
          if (landed.size) {
            writeStamp(sbStampKey(me), now);
            notePresenceLanded(me, landed);
          }
          // Не легло (нет таблицы, отказ, человека ещё нет в копии прав) —
          // пишем по-старому, иначе он выпал бы из «в сети» у всех.
          fsList = [...fsIds, ...rest];
        }
        if (fsList.length && fsDue()) {
          // Штамп — только после записи, дошедшей до сервера: неудача не
          // должна глушить Firestore-пульс старых вкладок. И ставим время
          // НАЧАЛА удара — ровно то lastActiveAt, что легло в документ:
          // запись, провисевшая без сети, не должна засчитываться как свежий
          // удар. Неудача ставит свою отметку «не повторять до» (fsRetryKey).
          if (await beatFirestore(me, fsList, now)) writeStamp(fsStampKey(me), now);
          else writeStamp(fsRetryKey(me), now);
        }
      })()
        .catch(() => undefined)
        .finally(() => {
          beatInFlight.delete(me);
        });
    }

    beat();
    const interval = setInterval(beat, HEARTBEAT_INTERVAL_MS);
    document.addEventListener("visibilitychange", beat);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", beat);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, JSON.stringify(workspaceIds), listResolved, workspacesSignature]);
}
