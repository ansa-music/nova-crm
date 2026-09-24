import { useEffect, useRef, useState } from "react";
import { updateDoc } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths } from "@/firebase/firestore";
import { toast } from "@/components/ui/sonner";
import { useWorkspace } from "@/hooks/useWorkspace";
import { resolveOsDeskKeys, type OsDeskKeys } from "@/services/osDeskService";
import {
  findTechTarget,
  pushOrderToTech,
  sbFetchRowById,
  techTargetProblem,
  techUidByNick,
} from "@/services/rows/osOrderMirror";
import { isClaimedOriginal, sbReleaseOsClaim } from "@/services/rows/osOrderClaim";
import { ringRowsDoorbell } from "@/services/rows/rowsDoorbell";
import { sbDeleteRow } from "@/services/rows/supabaseRowStore";
import {
  createPassRefresher,
  createSingleFlight,
  findDuplicateMirrors,
  mirrorAddressOf,
  mirrorForRow,
  noteRowChanges,
  orderListStaleFor,
  planOsDispatch,
  type RowChangeMemory,
} from "@/utils/osDispatchPlan";
import { sbPatchRow } from "@/services/rows/supabaseRowStore";
import { usesSupabaseRows } from "@/services/rows/rowsBackend";
import {
  approvalStatusValue,
  DEFAULT_STATUS_OPTIONS,
  ensureApprovalStatus,
  ensureDoneStatus,
  findInProgressStatusOption,
  isApprovalStatusValue,
} from "@/utils/columnOptions";
import { logOsDispatch } from "@/services/osDispatchLogService";
import { isExchangeHandoffRow } from "@/services/rows/osExchange";
import { firestoreErrorText } from "@/utils/dbError";
import { OS_ISSUED_AT_KEY, OS_ISSUED_ON_KEY, OS_LOST_FOR_KEY, OS_STATUS_SENT_KEY } from "@/utils/reservedCellKeys";
import { personLabel } from "@/utils/peopleDesks";
import { osRowTotal } from "@/utils/payment";
import { OS_DEAD_LINK_PROBLEM } from "@/utils/osTechCell";
import type { PageColumn, PageRow } from "@/types";

/**
 * Стол ОС работает САМ: заполнил строку и выбрал технаря — заказ уже у него.
 *
 * Так просил Nurba: «ОС со своего стола сразу может выдавать заказ». Кнопка
 * «Выдать в работу» в карточке осталась запасной (например, технаря нет в
 * сети или у него ещё нет стола) — обычный путь теперь без кнопки вовсе.
 *
 * Здесь же живёт СИНХРОНИЗАЦИЯ СТАТУСА в обе стороны:
 * - ОС поменял статус у себя → он уезжает в строку технаря (по ней считают
 *   «Технари», дашборд и оценки — там статус и есть настоящий);
 * - статус поменяли в строке технаря (Тимлид поставил «Успешку», Owner
 *   закрыл заказ) → он подтягивается обратно в стол ОС, чтобы столбец не
 *   врал.
 *
 * Что считать «правкой ОС» — `syncHash`: подпись зеркалируемых полей,
 * посчитанная в момент прошлой выдачи. Отличается — значит ОС что-то
 * поменял у себя; совпадает, а статус у технаря другой — значит поменяли
 * там. Двух источников правды это не создаёт: спорных случаев нет, потому
 * что в каждом такте побеждает ровно одна сторона.
 *
 * Пишем не на каждое нажатие клавиши: пауза после последней правки строки
 * (DEBOUNCE_MS), и строка, по которой запись уже идёт, второй раз в этот
 * такт не берётся.
 *
 * УТВЕРЖДЕНИЕ (просьба Nurba 23.09.2026): новый заказ получает статус
 * «Утверждение» и технарю НЕ уходит, даже если технарь уже выбран. Когда ОС
 * ставит «В работе» (любой статус, кроме утверждения), стол спрашивает, как
 * отдать заказ: «Общий» — на биржу «Заказы», всем технарям, или
 * «Выборочно» — выбранному технарю (`choiceRow`, диалог рисует стол).
 * Выдачу выбранному технарю (и смену, и снятие) проход пишет в журнал
 * «Выдачи ОС» — его смотрят Тимлид и Owner.
 */
const DEBOUNCE_MS = 700;

export interface OsDeskDispatchInput {
  workspaceId: string | null;
  /** Только на СВОЁМ столе ОС: заказы выдаёт их хозяин. */
  enabled: boolean;
  pageId: string;
  subPageId: string | null;
  rows: PageRow[];
  /** Столбцы открытой таблицы — ключи ячеек берём из них (resolveOsDeskKeys). */
  columns?: readonly PageColumn[] | null;
  /** Заказы этого ОС в столах технарей (useMyOrderRows). */
  orders: {
    /** Все заказы этого ОС — по ним видно и лишние копии одного заказа. */
    rows: PageRow[];
    bySource: Map<string, PageRow>;
    refresh: () => void;
    /** Список ещё читается — трогать ничего нельзя (см. ниже про дубли). */
    loading: boolean;
    /** Список не прочитался: неполная картина — тоже не трогаем. */
    error: string | null;
    /**
     * performance.now() начала чтения, результат которого в `rows`
     * (`useMyOrderRows`). Строка поменялась позже — по этому списку не решаем
     * «тянуть статус» и «копия пропала» (см. orderListStaleFor). Нет поля —
     * по-старому, без этой проверки.
     */
    fetchedAtLocal?: number;
  };
  osUid: string;
  osNickValue: string;
  /**
   * Строки стола пришли С СЕРВЕРА (не из кэша и не пустота до первой выборки).
   * Только по такому списку можно решать «строки больше нет — убрать заказ у
   * технаря»: по неполному списку проход снял бы живые заказы.
   */
  rowsFromServer?: boolean;
  /**
   * Свои заказы на «Заказах» (useMyExchangeOrders): открытые и отданные, по
   * id строки. `orderId` на строке ещё не значит «висит на бирже» — заказ
   * могли снять (отменить, удалить) или взять, а технаря потом стереть.
   * Нет или не прочитано — считаем, что висит (осторожно: без второго заказа).
   */
  exchange?: { loaded: boolean; byRow: ReadonlyMap<string, unknown> };
}

/** Сколько заказ строки должен НЕ находиться на бирже, чтобы считаться снятым. */
const STALE_ORDER_GRACE_MS = 5_000;

/**
 * Заказ строки сейчас на «Заказах» (или мы этого ещё не знаем). «Снят» —
 * только если его нет в прочитанном списке дольше `STALE_ORDER_GRACE_MS`:
 * заказ, выставленный из другой вкладки («Заказы»), доходит до списка этой
 * вкладки позже, чем строка с его `orderId`, и без запаса проход счёл бы его
 * снятым (вопрос «Как отдать заказ?» у только что выставленного).
 * `staleSince` — когда впервые увидели «нет в списке» (ключ строка:заказ).
 */
function orderOnExchange(
  row: PageRow,
  exchange: OsDeskDispatchInput["exchange"],
  staleSince: Map<string, number>,
  now: number
): boolean {
  if (!row.orderId) return false;
  if (!exchange || !exchange.loaded) return true;
  const key = `${row.id}:${row.orderId}`;
  if (exchange.byRow.has(row.id)) {
    staleSince.delete(key);
    return true;
  }
  const since = staleSince.get(key);
  if (since === undefined) {
    staleSince.set(key, now);
    return true;
  }
  return now - since < STALE_ORDER_GRACE_MS;
}

function cellText(row: PageRow, key: string | undefined): string {
  if (!key) return "";
  const value = row.cells[key];
  return value === null || value === undefined ? "" : String(value).trim();
}

// Текст метки «связь с копией оборвана» живёт рядом с моделью ячейки
// «Технарь» (она решает по нему, что показать); отсюда — для старых импортов.
export { OS_DEAD_LINK_PROBLEM };

export function useOsDeskDispatch(input: OsDeskDispatchInput) {
  const { pages, members, activeWorkspace } = useWorkspace();
  const latest = useRef(input);
  latest.current = input;
  const statusOptions = ensureApprovalStatus(ensureDoneStatus(activeWorkspace?.statusOptions ?? DEFAULT_STATUS_OPTIONS));
  const ctx = useRef({ pages, members, statusOptions });
  ctx.current = { pages, members, statusOptions };
  /**
   * Какой статус был у строки в прошлый проход — по переходу «Утверждение →
   * В работе» стол спрашивает, как отдать заказ. Первый проход только
   * запоминает: открыть стол — не повод для вопроса.
   */
  const seenStatus = useRef(new Map<string, string>());
  /** Когда заказ строки впервые не нашёлся на бирже (см. orderOnExchange). */
  const staleOrderSince = useRef(new Map<string, number>());
  const seenScope = useRef("");
  /** Строка, по которой стол спрашивает «общий или выборочно». */
  const [choiceRowId, setChoiceRowId] = useState<string | null>(null);
  /** Строки, по которым прямо сейчас идёт запись. */
  const busy = useRef(new Set<string>());
  /**
   * Когда (performance.now()) строка поменялась ЗДЕСЬ — статус, `osStatusSent`,
   * адрес копии. Сверяется с тем, когда начал читаться список заказов.
   */
  const changes = useRef<RowChangeMemory & { scope: string }>({ scope: "", seen: new Map(), changedAt: new Map() });
  /** О чём уже сказали человеку — чтобы не повторять тост на каждый такт. */
  const told = useRef(new Set<string>());

  /** Почему заказ не доходит до технаря — по id строки (стол рисует метку). */
  const [problems, setProblems] = useState<Record<string, string>>({});
  const setProblem = (rowId: string, text: string | null) =>
    setProblems((prev) => {
      if ((prev[rowId] ?? null) === text) return prev;
      const next = { ...prev };
      if (text) next[rowId] = text;
      else delete next[rowId];
      return next;
    });
  /** Снять метку, только если это именно она (другую причину не трогаем). */
  const dropProblem = (rowId: string, text: string) =>
    setProblems((prev) => {
      if (prev[rowId] !== text) return prev;
      const next = { ...prev };
      delete next[rowId];
      return next;
    });

  const { workspaceId, enabled, rows, orders } = input;
  const keys = resolveOsDeskKeys(input.columns);
  /**
   * Пока список своих заказов не прочитан, проход НЕ работает: иначе каждая
   * строка выглядит невыданной, и заказ уезжает технарю ВТОРОЙ раз — те самые
   * дубли. Вторая страховка — адрес копии на самой строке (mirrorAddressOf).
   */
  const ready = !orders.loading && !orders.error;
  const active = Boolean(enabled && workspaceId && ready && usesSupabaseRows(workspaceId ?? ""));
  const activeNow = useRef(active);
  activeNow.current = active;

  // Правки строк отмечаем при отрисовке — раньше, чем проход или чтение
  // списка успеют начаться (отметка раньше правды только перестраховывает).
  {
    const scope = `${workspaceId ?? ""}|${input.pageId}|${input.subPageId ?? ""}`;
    if (changes.current.scope !== scope) changes.current = { scope, seen: new Map(), changedAt: new Map() };
    if (enabled) noteRowChanges(changes.current, rows, keys.status, performance.now());
  }
  // Подпись: правка строки меняет updatedAt, выдача — появление зеркала.
  // В подпись идут и сами ячейки статуса и технаря: своя правка ложится
  // оптимистично, и `updatedAt` у строки может не смениться до ответа базы —
  // проход тогда не видел, что ОС поменял статус.
  const signature = active
    ? rows
        .map((r) => `${r.id}:${r.updatedAt}:${r.syncHash ?? ""}:${cellText(r, keys.status)}:${cellText(r, keys.technician)}:${cellText(r, keys.client)}`)
        .join("|") +
      "#" +
      [...orders.bySource.entries()].map(([id, m]) => `${id}:${m.updatedAt}:${m.statusKey ? cellText(m, m.statusKey) : ""}`).join("|") +
      `#${JSON.stringify(keys)}`
    : "";

  // Столы технарей и ники участников — тоже в подпись: технарь открыл свой
  // стол, карта столбцов доехала, а проход без этого не просыпался, пока ОС
  // сам что-нибудь не поправит.
  const targetsSignature = active
    ? pages
        .filter((p) => !p.osDesk)
        .map((p) => `${p.id}:${p.autoMonthSubPageId ?? ""}:${p.osFieldKeys?.tabId ?? ""}:${p.osFieldKeys?.os ?? ""}:${p.inactive ? 1 : 0}`)
        .join("|") +
      "#" +
      members.map((m) => `${m.uid}:${m.techNickValue ?? ""}:${m.status}`).join("|")
    : "";

  /**
   * Один проход за раз (гонка 24.09.2026): таймер взводится на каждую правку
   * строки, а проход асинхронный — второй, начатый поверх первого, решал по
   * списку заказов, который первый как раз менял, и тянул технарю старый
   * статус. Просьба во время прохода — «пройди ещё раз» после него.
   */
  const flight = useRef<ReturnType<typeof createSingleFlight> | null>(null);
  const sweepRef = useRef<() => Promise<void>>(async () => undefined);
  /**
   * Проход попросил перечитать свои заказы (что-то записал или решал по
   * устаревшему списку). Тогда повтор сразу после прохода НЕ идёт: список ещё
   * старый (React не успел даже поставить `loading`), и повтор по нему
   * «переводил» бы заказ ещё раз — второй «move»/«забрал» в «Выдачах ОС»,
   * тост и подсветка у технаря. Просьба не теряется: перечитывание снимает и
   * возвращает `active`, эффект ниже взводит таймер, и следующий проход идёт
   * уже по свежему списку.
   */
  const refreshQueued = useRef(false);
  if (!flight.current)
    flight.current = createSingleFlight(
      () => sweepRef.current(),
      () => activeNow.current && !refreshQueued.current
    );

  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => {
      void flight.current?.trigger().catch((error) => console.warn("[os-desk] проход стола ОС упал", error));
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, signature, targetsSignature]);

  sweepRef.current = sweep;
  async function sweep() {
    refreshQueued.current = false;
    const cur = latest.current;
    const { pages: allPages, members: allMembers, statusOptions } = ctx.current;
    if (!cur.workspaceId) return;
    // Стол закрыли или список заказов перечитывается — ждём: проход по
    // неполной картине и есть источник дублей и «пропавших» копий.
    if (!activeNow.current || cur.orders.loading || cur.orders.error) return;
    const refresher = createPassRefresher(() => {
      refreshQueued.current = true;
      cur.orders.refresh();
    });
    const changedAt = changes.current.changedAt;
    const k: OsDeskKeys = resolveOsDeskKeys(cur.columns);
    const OS_COLUMNS = { client: k.client, phone: k.phone, price: k.price, upsell: k.upsell, note: k.note, link: k.link };
    const techColumn = { key: k.technician };
    const statusColumn = { key: k.status };
    let changed = false;
    const scope = `${cur.workspaceId}|${cur.pageId}|${cur.subPageId ?? ""}`;
    const firstLook = seenScope.current !== scope;
    if (firstLook) {
      seenScope.current = scope;
      seenStatus.current = new Map();
    }
    const nameOf = (uid: string | null | undefined, fallback = "") =>
      (uid ? personLabel(allMembers.find((m) => m.uid === uid)) : "") || fallback;
    const osName = nameOf(cur.osUid, "ОС");

    // Сначала убираем лишние копии одного заказа: иначе они посчитаются у
    // технаря дважды, а проход ниже будет чинить не ту строку.
    const extra = findDuplicateMirrors({
      rows: cur.rows,
      orders: cur.orders.rows,
      targetPageOf: (srcRowId) => {
        const row = cur.rows.find((r) => r.id === srcRowId);
        const nick = row && techColumn ? cellText(row, techColumn.key) : "";
        const uid = techUidByNick(allMembers, nick);
        return uid ? (findTechTarget(allPages, uid, row?.mirrorPageId)?.page.id ?? "") : "";
      },
    });
    let removedDups = 0;
    const dupSources = new Set<string>();
    for (const dup of extra) {
      try {
        await sbDeleteRow(cur.workspaceId, dup.pageId, dup.tabId, dup.rowId);
        changed = true;
        removedDups += 1;
        const src = cur.orders.rows.find((o) => o.id === dup.rowId && o.deskPageId === dup.pageId)?.srcRowId;
        if (src) dupSources.add(src);
      } catch {
        // Не вышло — попробуем в следующий проход.
      }
    }
    if (removedDups) toast.success(`Убрал лишние копии заказов: ${removedDups}`);

    // Строку удалили со стола ОС — заказ уходит и из стола технаря (жалоба
    // Nurba 23.09.2026: «удаляешь заказ — у технаря он остаётся»). Сирота —
    // копия, чья строка-источник лежала в ЭТОЙ таблице и её больше нет.
    // Только по списку строк с сервера: пустота до первой выборки сняла бы
    // все заказы разом.
    if (cur.rowsFromServer) {
      const present = new Set(cur.rows.map((r) => r.id));
      const tab = cur.subPageId ?? "";
      const orphans = cur.orders.rows.filter(
        (m) =>
          m.srcRowId &&
          m.srcPageId === cur.pageId &&
          (m.srcTabId ?? "") === tab &&
          m.osUid === cur.osUid &&
          !present.has(m.srcRowId) &&
          !busy.current.has(m.srcRowId)
      );
      let removedOrphans = 0;
      let returnedOrphans = 0;
      for (const m of orphans) {
        try {
          // Список строк стола и список заказов читаются порознь: сразу
          // после забора заказа (useOsOrderClaims) копия в списке уже есть,
          // а строка-источник до стола ещё не доехала. Удаляем, только
          // убедившись по первичному ключу, что источника правда нет.
          const source = await sbFetchRowById(cur.workspaceId, m.srcPageId ?? cur.pageId, m.srcTabId || null, m.srcRowId ?? "");
          if (source) continue;
          if (isClaimedOriginal(m)) {
            // Это СОБСТВЕННАЯ строка технаря, взятая ОС (перенос или забор):
            // удалить её — стереть технарю его заказ. Возвращаем ему строку и
            // стираем свой ник, иначе её тут же забрали бы снова.
            const released = await sbReleaseOsClaim(cur.workspaceId, m.deskPageId ?? "", m.tabId || null, m.id, true);
            if (released === "released") {
              changed = true;
              returnedOrphans += 1;
              continue;
            }
            if (released === "gone") {
              // Строки уже нет — список перечитаем, делать нечего.
              changed = true;
              continue;
            }
            // Ответ непонятен — не трогаем, спросим в следующий проход.
            if (released === "unknown") continue;
            // «unsupported» — SQL 20261002 не вставлен, вернуть строку нечем:
            // как до забора, копию удаляем. Иначе она осталась бы у технаря
            // под замком ОС, у ОС её не видно, а каждый проход заново спрашивал
            // бы о ней базу двумя запросами. «not_claimed» — база говорит, что
            // строку завёл ОС (не взята у технаря): тоже удаляем.
          }
          await sbDeleteRow(cur.workspaceId, m.deskPageId ?? "", m.tabId || null, m.id);
          changed = true;
          removedOrphans += 1;
          const deskPage = allPages.find((p) => p.id === m.deskPageId);
          const clientKey = deskPage?.osFieldKeys?.client;
          void logOsDispatch(cur.workspaceId, {
            kind: "unassign",
            osUid: cur.osUid,
            osName,
            techUid: null,
            techName: "",
            prevTechName: nameOf(deskPage?.responsibleUserId, "технарь"),
            client: clientKey ? cellText(m, clientKey) : "",
            phone: "",
            amount: null,
            srcPageId: cur.pageId,
            srcRowId: m.srcRowId ?? "",
          }).catch(() => undefined);
        } catch {
          // Не вышло — повторим в следующий проход.
        }
      }
      if (removedOrphans) {
        toast.success(removedOrphans === 1 ? "Удалённый заказ убран у технаря" : `Удалённые заказы убраны у технарей: ${removedOrphans}`);
      }
      if (returnedOrphans) {
        toast.success(
          returnedOrphans === 1 ? "Заказ вернули технарю" : `Заказы вернули технарям: ${returnedOrphans}`,
          { description: "Строка осталась у технаря, ваш ник с неё снят." }
        );
      }
    }

    for (const row of cur.rows) {
      if (busy.current.has(row.id)) continue;
      // Только что убрали лишние копии этой строки — план по устаревшему
      // списку выбрал бы удалённую; дождёмся перечитывания.
      if (dupSources.has(row.id)) continue;
      const client = cellText(row, OS_COLUMNS.client);
      const techNick = techColumn ? cellText(row, techColumn.key) : "";
      const mirror = mirrorForRow(row, cur.orders.rows);
      const at = mirrorAddressOf(row, mirror);
      const statusNow = statusColumn ? cellText(row, statusColumn.key) : "";
      const onApproval = isApprovalStatusValue(statusNow, statusOptions);
      const prevStatus = seenStatus.current.get(row.id);
      seenStatus.current.set(row.id, statusNow);

      const onExchangeNow = orderOnExchange(row, cur.exchange, staleOrderSince.current, Date.now());
      // Новый заказ (имя есть, статуса нет, никому не отдан) — «Утверждение».
      if (statusColumn && !statusNow && client && !at && !techNick && !onExchangeNow) {
        busy.current.add(row.id);
        try {
          await sbPatchRow(cur.workspaceId, cur.pageId, cur.subPageId, row.id, {
            cells: { [statusColumn.key]: approvalStatusValue(statusOptions) },
          });
          changed = true;
        } catch {
          // Не вышло — попробуем в следующий проход; выдачу это не держит.
        } finally {
          busy.current.delete(row.id);
        }
        continue;
      }

      // «Утверждение → В работе» у заказа, который ещё никому не отдан, —
      // спросить, как отдать. На первом взгляде на стол не спрашиваем.
      if (
        !firstLook &&
        prevStatus !== undefined &&
        isApprovalStatusValue(prevStatus, statusOptions) &&
        !onApproval &&
        !techNick &&
        !at &&
        // Заказ, снятый с «Заказов», — снова «никому не отдан».
        !onExchangeNow &&
        client
      ) {
        setChoiceRowId(row.id);
      }

      // Связь с копией оборвана («Вернуть» на «Правке столов», копию
      // удалили) — статус к технарю не уходит, и ОС должен это видеть.
      if (!at && techNick && cellText(row, OS_LOST_FOR_KEY) === techNick) {
        setProblem(row.id, OS_DEAD_LINK_PROBLEM);
        continue;
      }
      dropProblem(row.id, OS_DEAD_LINK_PROBLEM);

      // На утверждении заказ технарю не уходит, даже если технарь выбран
      // («Только наметить технаря»). Подсказка — только когда технаря наметили
      // сейчас, а не на каждом открытии стола: состояние и так видно в ячейке
      // («Отдать» в столбце «Технарь»).
      if (!at && onApproval) {
        // Невыданному заказу на утверждении доставлять нечего — старая
        // причина («нет вкладки месяца», отказ записи) с тех пор, как он был
        // «В работе», больше не про него: иначе она прятала бы «Отдать» в
        // ячейке, пока стол не откроют заново. Оборванная связь уже решена выше.
        setProblem(row.id, null);
        if (techNick && client && !firstLook && !told.current.has(`${row.id}:approval`)) {
          told.current.add(`${row.id}:approval`);
          toast.info(`${client}: технарь намечен`, {
            description: "Заказ ещё на утверждении. Чтобы он уехал к технарю, нажмите «Отдать» в столбце «Технарь».",
          });
        }
        continue;
      }
      if (!techNick && !at) continue;

      // Ник стёрли — заказ забирают у технаря. Стол ему для этого не нужен.
      // Адрес копии со строки снимаем тут же: иначе следующий проход снова
      // «удалял» бы уже удалённое и сыпал тостами.
      if (!techNick && at) {
        busy.current.add(row.id);
        try {
          if (mirror) await sbDeleteRow(cur.workspaceId, at.pageId, at.tabId, at.rowId);
          await sbPatchRow(cur.workspaceId, cur.pageId, cur.subPageId, row.id, {
            cells: { [OS_STATUS_SENT_KEY]: "", [OS_LOST_FOR_KEY]: "", [OS_ISSUED_AT_KEY]: "", [OS_ISSUED_ON_KEY]: "" },
            clearMirror: true,
          });
          changed = true;
          if (!mirror) {
            busy.current.delete(row.id);
            continue;
          }
          toast.success("Заказ убран у технаря", { description: client || undefined });
          const prevUid = allPages.find((p) => p.id === at.pageId)?.responsibleUserId ?? null;
          void logOsDispatch(cur.workspaceId, {
            kind: "unassign",
            osUid: cur.osUid,
            osName,
            techUid: null,
            techName: "",
            prevTechName: nameOf(prevUid, "технарь"),
            client,
            phone: cellText(row, OS_COLUMNS.phone),
            amount: orderAmount(row, OS_COLUMNS),
            srcPageId: cur.pageId,
            srcRowId: row.id,
          }).catch(() => undefined);
        } catch (error) {
          const text = firestoreErrorText(error, "Не удалось убрать заказ у технаря");
          if (!told.current.has(`${row.id}:${text}`)) {
            told.current.add(`${row.id}:${text}`);
            toast.error(text);
          }
        } finally {
          busy.current.delete(row.id);
        }
        continue;
      }
      if (!client && !at) continue;

      const techUid = techUidByNick(allMembers, techNick);
      // Стол, где заказ уже лежит, — первым: у человека бывает несколько
      // столов, и заказ не должен «переезжать» между ними сам.
      const problem = techTargetProblem(allPages, techUid, at?.pageId);
      const target = techUid ? findTechTarget(allPages, techUid, at?.pageId) : null;
      if (problem || !target || !techUid) {
        // Молча не выдаём, но один раз объясняем почему: иначе заказ
        // «висит» на столе ОС, и непонятно, дошёл он или нет.
        const reason = problem ?? "Не нашёл стол технаря";
        setProblem(row.id, reason);
        if (!told.current.has(`${row.id}:${reason}`)) {
          told.current.add(`${row.id}:${reason}`);
          toast.error(`${client || "Заказ"}: ${reason}`);
        }
        // Заказ уже у технаря, а ОС сменил статус — статус доезжает и без
        // карты столбцов: ключ статуса записан на самой копии. Иначе
        // «Ждём оплату» у ОС и «В работе» у технаря висели бы, пока технарь
        // не откроет свой стол.
        const theirs = mirror?.statusKey ? cellText(mirror, mirror.statusKey) : "";
        if (
          at &&
          mirror?.statusKey &&
          statusNow &&
          !onApproval &&
          statusNow !== theirs &&
          techUid &&
          mirror.deskPageId &&
          allPages.find((p) => p.id === mirror.deskPageId)?.responsibleUserId === techUid &&
          prevStatus !== undefined &&
          prevStatus !== statusNow
        ) {
          busy.current.add(row.id);
          try {
            await sbPatchRow(cur.workspaceId, at.pageId, at.tabId, at.rowId, { cells: { [mirror.statusKey]: statusNow } });
            changed = true;
          } catch {
            // Не вышло — метка на строке остаётся, ОС видит, что не доехало.
          } finally {
            busy.current.delete(row.id);
          }
        }
        continue;
      }
      setProblem(row.id, null);

      // Список заказов читался ДО последней правки этой строки — по нему
      // нельзя решать ни «копии нет», ни «статус сменили у технаря».
      const staleList = orderListStaleFor(changedAt.get(row.id), cur.orders.fetchedAtLocal);
      const plan = planOsDispatch({
        row,
        mirror,
        keys: target.keys,
        osColumns: OS_COLUMNS,
        osNickValue: cur.osNickValue,
        osStatusKey: statusColumn?.key ?? null,
        techNick,
        client,
        fallbackStatus: findInProgressStatusOption(statusOptions)?.value ?? "",
        targetPageId: target.page.id,
        ordersLoaded: !staleList,
      });
      if (staleList && (plan.action === "pull" || plan.action === "lost" || (plan.action === "wait" && at && !mirror))) {
        // «pull» по старому списку — это почти всегда статус ОС, который уже
        // уехал в копию САМОЙ базой (desk_rows_os_status_push, SQL 20261002):
        // osStatusSent поставила она же. Звонка база не делает — звоним столу
        // копии сами, иначе открытый стол технаря узнал бы о статусе только с
        // опросом головы таблицы (до минуты).
        if (plan.action === "pull" && at) ringRowsDoorbell(cur.workspaceId, at.pageId, at.tabId ?? "");
        refresher.later();
        continue;
      }
      if (plan.action === "none" || plan.action === "wait") continue;

      // Копию удалили у технаря (Owner, вкладка) — снимаем адрес и НЕ
      // выдаём заново: удаление — решение. Перевыдать можно кнопкой в
      // карточке или сменой технаря.
      if (plan.action === "lost") {
        busy.current.add(row.id);
        try {
          await sbPatchRow(cur.workspaceId, cur.pageId, cur.subPageId, row.id, {
            cells: plan.sourceCells,
            clearMirror: true,
          });
          changed = true;
          const reason = "Копию заказа удалили у технаря — выдать заново можно из карточки";
          setProblem(row.id, reason);
          if (!told.current.has(`${row.id}:lost`)) {
            told.current.add(`${row.id}:lost`);
            toast.info(`${client || "Заказ"}: ${reason}`);
          }
        } catch {
          // Не вышло — попробуем в следующий проход.
        } finally {
          busy.current.delete(row.id);
        }
        continue;
      }

      busy.current.add(row.id);
      try {
        // Сменили технаря: сначала убираем заказ у прежнего, иначе он
        // останется висеть в его столе и посчитается в его загрузке.
        if (plan.action === "move" && plan.removeAt) {
          await sbDeleteRow(cur.workspaceId, plan.removeAt.pageId, plan.removeAt.tabId, plan.removeAt.rowId);
        }
        if (plan.action === "push" || plan.action === "move") {
          const pushed = await pushOrderToTech({
            workspaceId: cur.workspaceId,
            osUid: cur.osUid,
            osNickValue: cur.osNickValue,
            source: row,
            srcPageId: cur.pageId,
            srcTabId: cur.subPageId,
            osColumns: OS_COLUMNS,
            target,
            techUid,
            status: plan.status,
            withStatus: plan.withStatus,
            sourceCells: plan.sourceCells,
            dateMs: Math.max(row.createdAt || 0, row.filledAt || 0) || 0,
            // При переезде id копии выводим заново: у прежнего технаря
            // строка могла быть его собственной (перенесённый заказ).
            mirrorRowId: plan.action === "move" ? undefined : plan.mirrorRowId,
            // Копия остаётся в своей вкладке: на переломе месяца иначе
            // появилась бы вторая строка того же заказа в новой вкладке.
            mirrorTabId: plan.action === "move" ? undefined : plan.mirrorTabId,
            // Правим существующую копию — под её ключом статуса и с её
            // опорными полями (страж базы отклоняет их смену).
            copy: plan.action === "push" && plan.mirrorRowId ? mirror : undefined,
            osStatusKey: statusColumn.key,
          });
          changed = true;
          // Список заказов — сразу: следующий проход не должен решать по
          // списку, в котором этой записи ещё нет.
          refresher.now();
          if (!plan.hadMirror || plan.action === "move") {
            const name = personLabel(allMembers.find((m) => m.uid === techUid)) || techNick;
            toast.success(`Заказ у технаря: ${name}`, { description: client || undefined });
            const viaExchange = isExchangeHandoffRow(row.id);
            // Выдача выбранному технарю — в журнал руководству. Заказ,
            // пришедший с биржи, туда не пишем: его видно на «Заказах».
            if (!viaExchange) {
              const prevUid = plan.removeAt
                ? (allPages.find((p) => p.id === plan.removeAt?.pageId)?.responsibleUserId ?? null)
                : null;
              void logOsDispatch(cur.workspaceId, {
                kind: plan.action === "move" ? "move" : "assign",
                osUid: cur.osUid,
                osName,
                techUid,
                techName: name,
                prevTechName: prevUid ? nameOf(prevUid, "технарь") : null,
                client,
                phone: cellText(row, OS_COLUMNS.phone),
                amount: orderAmount(row, OS_COLUMNS),
                srcPageId: cur.pageId,
                srcRowId: row.id,
              }).catch(() => undefined);
            }
            // Заказ висел на бирже, а ОС отдал его сам — закрываем его там,
            // иначе технари продолжали бы откликаться на уже отданный заказ.
            // Только если он там ещё висит: снятый (отменённый) заказ
            // иначе воскрес бы в «В столах».
            if (row.orderId && onExchangeNow && !viaExchange && db) {
              const now = Date.now();
              void updateDoc(paths.order(cur.workspaceId, row.orderId), {
                status: "taken",
                takenAt: now,
                takenPageId: target.page.id,
                takenSubPageId: plan.mirrorTabId ?? target.tabId,
                takenRowId: pushed.rowId,
                updatedAt: now,
              }).catch(() => undefined);
            }
          }
        } else if (plan.action === "pull") {
          // Статус поменяли у технаря — показываем его у ОС и запоминаем как
          // синхронизированный (osStatusSent), иначе следующий проход счёл
          // бы это правкой ОС и отправил бы значение обратно.
          await sbPatchRow(cur.workspaceId, cur.pageId, cur.subPageId, row.id, {
            cells: plan.sourceCells,
            syncHash: plan.hash,
            ...(statusColumn.key !== (row.statusKey || "status") ? { statusKey: statusColumn.key } : {}),
          });
          // Копию не трогали — перечитывать список заказов незачем.
        }
      } catch (error) {
        const text = firestoreErrorText(error, "Не удалось отдать заказ технарю");
        setProblem(row.id, text);
        if (!told.current.has(`${row.id}:${text}`)) {
          told.current.add(`${row.id}:${text}`);
          toast.error(text);
        }
      } finally {
        busy.current.delete(row.id);
      }
    }
    if (changed) refresher.later();
    refresher.flush();
  }

  const choiceRow = choiceRowId ? (rows.find((r) => r.id === choiceRowId) ?? null) : null;
  return {
    /** Почему заказ не доходит до технаря — по id строки. */
    problems,
    /** Ключи ячеек открытой таблицы стола ОС. */
    keys,
    /** Заказ, по которому стол спрашивает «общий или выборочно». */
    choiceRow,
    openChoice: (rowId: string) => setChoiceRowId(rowId),
    closeChoice: () => setChoiceRowId(null),
  };
}

/** Касса заказа — как сумма у технаря: цена и апсейл за вычетом комиссии. */
function orderAmount(row: PageRow, OS_COLUMNS: { price: string; upsell: string }): number | null {
  const total = osRowTotal(row, OS_COLUMNS);
  return total && total > 0 ? total : null;
}
