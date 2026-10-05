import { useEffect, useRef, useState } from "react";
import { markOrderTaken } from "@/services/orderService";
import { toast } from "@/components/ui/sonner";
import { useWorkspace } from "@/hooks/useWorkspace";
import { resolveOsDeskKeys, type OsDeskKeys } from "@/services/osDeskService";
import {
  buildMirrorCells,
  findTechTarget,
  mirrorSyncHash,
  pushOrderToTech,
  sbFetchRowById,
  techTargetProblem,
  techUidByNick,
} from "@/services/rows/osOrderMirror";
import { isClaimedOriginal, sbReleaseOsClaim } from "@/services/rows/osOrderClaim";
import { ringRowsDoorbell } from "@/services/rows/rowsDoorbell";
import { sbDeleteRow } from "@/services/rows/supabaseRowStore";
import { fetchTechSyncState, techSyncActive } from "@/services/rows/techSync";
import { sendNotification } from "@/services/notificationService";
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
import { deskRowHref } from "@/utils/deskLinks";
import { parseLooseNumber } from "@/utils/numberInput";
import { OS_ISSUED_AT_KEY, OS_ISSUED_ON_KEY, OS_LOST_FOR_KEY, OS_STATUS_SENT_KEY } from "@/utils/reservedCellKeys";
import { personLabel } from "@/utils/peopleDesks";
import { osRowTotal } from "@/utils/payment";
import { OS_DEAD_LINK_PROBLEM } from "@/utils/osTechCell";
import { techFillsDesk } from "@/utils/techSyncPlan";
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
 *
 * АВТО-ПЕРЕДАЧА ОС (05.10.2026, SQL 20261045): на столе «Заполняет сам» база
 * сама связывает строку технаря со столом ОС — через секунду после того, как
 * он её вписал. Поэтому проход стал осторожнее:
 * - «копии нет в списке — её удалили» (`lost`) в ЛЮБОМ режиме сначала
 *   сверяется по первичному ключу: только что связанная строка в прочитанный
 *   список ещё не попала, и проход рвал живую связь;
 * - на столе с работающей авто-передачей СОБСТВЕННУЮ строку технаря, взятую
 *   ОС (`isClaimedOriginal`), проход не удаляет никогда — ни при снятии
 *   технаря, ни при смене технаря, ни при уборке лишних копий: технарь писал
 *   её сам. Строка возвращается ему (метка заказа и ник ОС снимаются);
 * - переезд заказа между двумя столами ОДНОГО человека там же не выполняется:
 *   заказ остаётся, где лежит, на строке — причина;
 * - пересылка одних ПОЛЕЙ в существующую копию там же идёт не по строке с
 *   экрана (ей до секунды), а по строкам, перечитанным по первичному ключу:
 *   правки технаря база сама увозит в источник (триггер `desk_rows_tech_push`),
 *   подпись источника при этом не меняется, и проход по старому снимку
 *   стирал бы технарю только что вписанное. Копия уже держит те же значения —
 *   в неё не пишем вовсе, только ставим подпись на источник.
 * В остальных режимах и пока SQL не вставлен всё, кроме первого, не действует.
 */
const DEBOUNCE_MS = 700;
/** Сколько раз подряд ждём, что живая копия появится в списке заказов (см. `lost`). */
const COPY_WAIT_PASSES = 3;

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
   * Кто за этим браузером: сам ОС стола или Owner, ведущий его выдачу. Вернуть
   * технарю его строку сам ОС может функцией базы (`rows_os_release_claim`),
   * Owner — обычной правкой. Нет поля — считаем, что проход ведёт сам ОС.
   */
  actorUid?: string | null;
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

/**
 * Копия у технаря уже держит всё, что записала бы пересылка полей (`want` —
 * `buildMirrorCells` по источнику): тогда писать в неё нечего. Сумма
 * сравнивается числом (у технаря «50 000», в пересылке «50000»), остальные
 * ячейки — строками без краевых пробелов, визитка — как JSON. Визитку
 * пересылка пишет, только когда она у источника есть (`pushOrderToTech`), —
 * пустая визитка источника копию не меняет и расхождением не считается.
 */
export function copyHoldsMirror(
  copy: PageRow,
  want: Record<string, string | number | null>,
  priceKey: string | undefined,
  source: PageRow
): boolean {
  for (const [key, value] of Object.entries(want)) {
    const theirs = String(copy.cells?.[key] ?? "").trim();
    const ours = String(value ?? "").trim();
    if (theirs === ours) continue;
    if (key !== priceKey) return false;
    const a = parseLooseNumber(theirs);
    const b = parseLooseNumber(ours);
    if (a === null || b === null || a !== b) return false;
  }
  if (source.extras === null || source.extras === undefined) return true;
  return JSON.stringify(copy.extras ?? null) === JSON.stringify(source.extras);
}

// Текст метки «связь с копией оборвана» живёт рядом с моделью ячейки
// «Технарь» (она решает по нему, что показать); отсюда — для старых импортов.
export { OS_DEAD_LINK_PROBLEM };

export function useOsDeskDispatch(input: OsDeskDispatchInput) {
  const { pages, allPages: everyPage, members, activeWorkspace } = useWorkspace();
  const latest = useRef(input);
  latest.current = input;
  const statusOptions = ensureApprovalStatus(ensureDoneStatus(activeWorkspace?.statusOptions ?? DEFAULT_STATUS_OPTIONS));
  // `everyPage` — все столы, с «Неактуальными»: копия заказа может лежать и там
  // (выдача по-прежнему смотрит только активные `pages`).
  const ctx = useRef({ pages, everyPage: everyPage ?? pages, members, statusOptions, workspace: activeWorkspace });
  ctx.current = { pages, everyPage: everyPage ?? pages, members, statusOptions, workspace: activeWorkspace };
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
  /**
   * Сколько проходов подряд копия строки «жива и ссылается сюда», а в списке
   * заказов её всё нет (ключ строка:копия) — чтобы не перечитывать список по
   * кругу, если он её почему-то не отдаёт.
   */
  const copyWaits = useRef(new Map<string, number>());

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
    const { pages: allPages, everyPage: deskPages, members: allMembers, statusOptions, workspace } = ctx.current;
    if (!cur.workspaceId) return;
    const ws = cur.workspaceId;
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
    // Проход ведёт сам ОС стола (а не Owner от его имени).
    const selfOs = !cur.actorUid || cur.actorUid === cur.osUid;
    const nickWord = selfOs ? "ваш ник" : "ник ОС";

    /**
     * На столе, где лежит копия, работает авто-передача ОС (SQL 20261045):
     * стол «Заполняет сам», Owner её включил, ядро в Supabase. Состояние —
     * из памяти `techSync` (ответ базы помнится 5 минут), и спрашивается оно,
     * только когда дело дошло до строки на столе «Заполняет сам»: в остальных
     * режимах запроса нет вовсе, а без SQL ответ «нет» — и всё как раньше.
     */
    const syncDesk = async (pageId: string | null | undefined): Promise<boolean> => {
      // По всем столам, с «Неактуальными»: строка технаря — его и там.
      const deskPage = pageId ? deskPages.find((p) => p.id === pageId) : undefined;
      if (!deskPage || !techFillsDesk(deskPage, workspace)) return false;
      return techSyncActive(await fetchTechSyncState(ws));
    };

    /**
     * Вернуть технарю его СОБСТВЕННУЮ строку, которую вёл этот ОС: снять метку
     * заказа и стереть ник ОС (иначе авто-передача тут же связала бы строку
     * снова). Сам ОС — функцией базы (`rows_os_release_claim`); Owner, ведущий
     * проход чужого стола ОС, — обычной правкой: ему опорные поля менять можно.
     * `delete` — база говорит, что строку завёл ОС, а не взял у технаря: её
     * убирают удалением, как раньше. `skip` — ответ непонятен, повторим в
     * следующий проход. Повтор после сбоя следующего шага безопасен: уже
     * отпущенная строка — тоже `released`.
     */
    const releaseOriginal = async (addr: {
      pageId: string;
      tabId: string | null;
      rowId: string;
    }): Promise<"released" | "gone" | "delete" | "skip"> => {
      if (selfOs) {
        try {
          const out = await sbReleaseOsClaim(ws, addr.pageId, addr.tabId, addr.rowId, true);
          if (out === "released" || out === "gone") return out;
          return out === "not_claimed" ? "delete" : "skip";
        } catch (error) {
          // База отказала: строку могли отпустить прошлым проходом (её
          // следующий шаг тогда не удался) — сверяем по первичному ключу.
          const still = await sbFetchRowById(ws, addr.pageId, addr.tabId, addr.rowId).catch(() => undefined);
          if (still === null) return "gone";
          if (still && !still.osUid) return "released";
          throw error;
        }
      }
      // Правка несуществующей строки завела бы её заново — сначала сверяем.
      const still = await sbFetchRowById(ws, addr.pageId, addr.tabId, addr.rowId);
      if (!still) return "gone";
      if (!still.osUid) return "released";
      const osKeys = deskPages.find((p) => p.id === addr.pageId)?.osFieldKeys;
      const osKey = osKeys?.os && (osKeys.tabId || "") === (addr.tabId ?? "") ? osKeys.os : null;
      // Как в базе: ник стирается, только если в ячейке ник ЭТОГО ОС (другой
      // ник — технарь уже выбрал другого ОС, и строку свяжут с ним).
      const clearNick = Boolean(osKey && cur.osNickValue && cellText(still, osKey) === cur.osNickValue.trim());
      await sbPatchRow(ws, addr.pageId, addr.tabId, addr.rowId, {
        cells: clearNick && osKey ? { [osKey]: "" } : {},
        releaseOrder: true,
        clearSuccessRequest: true,
      });
      return "released";
    };

    /**
     * Копия «жива и ссылается сюда», а в списке заказов её нет — перечитать
     * список (если он её отдаст: это заказ ЭТОГО ОС) и подождать. Не больше
     * `COPY_WAIT_PASSES` раз подряд на строку: дальше просто ждём без запросов.
     */
    const waitForCopy = (rowId: string, copy: PageRow) => {
      const key = `${rowId}:${copy.deskPageId ?? ""}/${copy.id}`;
      const seen = copyWaits.current.get(key) ?? 0;
      if (copy.osUid !== cur.osUid || seen >= COPY_WAIT_PASSES) return;
      copyWaits.current.set(key, seen + 1);
      refresher.now();
    };

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
    let returnedDups = 0;
    const dupSources = new Set<string>();
    for (const dup of extra) {
      try {
        const copy = cur.orders.rows.find((o) => o.id === dup.rowId && o.deskPageId === dup.pageId);
        // Авто-передача: лишняя «копия» — собственная строка технаря. Не
        // удаляем, а возвращаем ему (см. шапку файла).
        let returned = false;
        if (copy && isClaimedOriginal(copy) && (await syncDesk(dup.pageId))) {
          const out = await releaseOriginal(dup);
          if (out === "skip") continue;
          if (out === "delete") await sbDeleteRow(ws, dup.pageId, dup.tabId, dup.rowId);
          else returned = out === "released";
          if (out === "gone") {
            changed = true;
            if (copy.srcRowId) dupSources.add(copy.srcRowId);
            continue;
          }
        } else {
          await sbDeleteRow(ws, dup.pageId, dup.tabId, dup.rowId);
        }
        changed = true;
        if (returned) returnedDups += 1;
        else removedDups += 1;
        if (copy?.srcRowId) dupSources.add(copy.srcRowId);
      } catch {
        // Не вышло — попробуем в следующий проход.
      }
    }
    if (removedDups) toast.success(`Убрал лишние копии заказов: ${removedDups}`);
    if (returnedDups) {
      toast.success(
        returnedDups === 1 ? "Лишнюю копию заказа вернули технарю" : `Лишние копии заказов вернули технарям: ${returnedDups}`,
        { description: `Это его собственная строка: она осталась у технаря, ${nickWord} с неё снят.` }
      );
    }

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
      // Копия в списке — счётчик «ждём, пока появится» больше не нужен.
      if (mirror && copyWaits.current.size > 0) copyWaits.current.delete(`${row.id}:${mirror.deskPageId ?? ""}/${mirror.id}`);
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
          // Авто-передача (SQL 20261045) на столе копии: собственную строку
          // технаря не удаляем — возвращаем ему; в остальных режимах — как было.
          const inScope = await syncDesk(at.pageId);
          let returned = false;
          if (!mirror && inScope) {
            // Копии нет в прочитанном списке, но база могла связать строку
            // секунду назад. Снять адрес с живой связи она всё равно не даст —
            // сверяем по первичному ключу и решаем в следующий проход, уже с
            // копией на руках. Не прочиталось — «не узнали», не трогаем.
            let copy: PageRow | null;
            try {
              copy = await sbFetchRowById(ws, at.pageId, at.tabId, at.rowId);
            } catch {
              continue;
            }
            if (copy && copy.osUid && copy.srcPageId === cur.pageId && copy.srcRowId === row.id) {
              waitForCopy(row.id, copy);
              continue;
            }
          }
          if (mirror) {
            if (inScope && isClaimedOriginal(mirror)) {
              const out = await releaseOriginal(at);
              if (out === "skip") continue;
              if (out === "delete") await sbDeleteRow(ws, at.pageId, at.tabId, at.rowId);
              else returned = out === "released";
            } else {
              await sbDeleteRow(cur.workspaceId, at.pageId, at.tabId, at.rowId);
            }
          }
          await sbPatchRow(cur.workspaceId, cur.pageId, cur.subPageId, row.id, {
            cells: { [OS_STATUS_SENT_KEY]: "", [OS_LOST_FOR_KEY]: "", [OS_ISSUED_AT_KEY]: "", [OS_ISSUED_ON_KEY]: "" },
            clearMirror: true,
          });
          changed = true;
          if (!mirror) {
            busy.current.delete(row.id);
            continue;
          }
          if (returned) {
            toast.success("Заказ вернули технарю", {
              description: `${client ? `${client}: ` : ""}строка осталась у технаря, ${nickWord} с неё снят.`,
            });
          } else {
            toast.success("Заказ убран у технаря", { description: client || undefined });
          }
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
      // Авто-передача (SQL 20261045): заказ лежит в одном столе технаря, а
      // писать сейчас можно только в другой его же стол (у первого, например,
      // ещё нет вкладки нового периода). Переезд между столами ОДНОГО человека
      // на столе с авто-передачей не выполняем: у прежнего стола строку
      // пришлось бы снять, и человек получил бы тот же заказ второй строкой
      // без своих правок. Заказ остаётся на месте, на строке — причина.
      if (mirror && at && at.pageId && at.pageId !== target.page.id) {
        const fromPage = allPages.find((p) => p.id === at.pageId);
        if (fromPage && !fromPage.inactive && fromPage.responsibleUserId === techUid && (await syncDesk(fromPage.id))) {
          const reason =
            techTargetProblem([fromPage], techUid, fromPage.id) ??
            "Заказ лежит в другом столе этого технаря — между его столами заказ не переезжает";
          setProblem(row.id, reason);
          if (!told.current.has(`${row.id}:${reason}`)) {
            told.current.add(`${row.id}:${reason}`);
            toast.error(`${client || "Заказ"}: ${reason}`);
          }
          continue;
        }
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
          // «Копии нет» — по списку заказов, а он читается отдельно от строк
          // стола и на первом взгляде не помечен устаревшим: строку, которую
          // база связала секунду назад (авто-передача, забор заказа), проход
          // объявлял потерянной и рвал живую связь. Решение необратимо —
          // сверяем по первичному ключу (во всех режимах): копия есть и
          // ссылается сюда — список отстал, перечитываем и ничего не снимаем;
          // не прочиталась — «не узнали», тоже не трогаем.
          const lostAt = plan.removeAt ?? at;
          if (lostAt) {
            let copy: PageRow | null;
            try {
              copy = await sbFetchRowById(ws, lostAt.pageId, lostAt.tabId, lostAt.rowId);
            } catch {
              continue;
            }
            if (copy && copy.osUid && copy.srcPageId === cur.pageId && copy.srcRowId === row.id) {
              waitForCopy(row.id, copy);
              continue;
            }
            copyWaits.current.delete(`${row.id}:${lostAt.pageId}/${lostAt.rowId}`);
          }
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
        /** Прежний технарь, которому при переезде вернули его собственную строку. */
        let returnedTo: string | null = null;
        if (plan.action === "move" && plan.removeAt) {
          // Авто-передача (SQL 20261045) на прежнем столе: собственную строку
          // технаря, взятую ОС, не удаляем — возвращаем ему без ника ОС (она
          // его, пока он сам её не уберёт). В остальных режимах — как было.
          if (mirror && isClaimedOriginal(mirror) && (await syncDesk(plan.removeAt.pageId))) {
            const out = await releaseOriginal(plan.removeAt);
            if (out === "skip") continue;
            if (out === "delete") {
              await sbDeleteRow(ws, plan.removeAt.pageId, plan.removeAt.tabId, plan.removeAt.rowId);
            } else if (out === "released") {
              returnedTo = deskPages.find((p) => p.id === plan.removeAt?.pageId)?.responsibleUserId ?? null;
            }
          } else {
            await sbDeleteRow(cur.workspaceId, plan.removeAt.pageId, plan.removeAt.tabId, plan.removeAt.rowId);
          }
        }
        if (plan.action === "push" || plan.action === "move") {
          /** Строка-источник и копия, по которым идёт запись (см. ниже — могут быть перечитаны). */
          let sourceRow: PageRow = row;
          let copyRow: PageRow | null = mirror;
          // Авто-передача (SQL 20261045): пересылка одних полей в существующую
          // копию. Правку технаря база уже увезла в источник той же записью, а
          // подпись источника (`syncHash`) она не трогает — проход видит
          // «поля разошлись» и слал бы технарю снимок источника с экрана,
          // которому до секунды: только что вписанная им ячейка стиралась.
          // Поэтому обе строки перечитываем по первичному ключу (копию первой:
          // источник тогда не старее копии) и решаем по свежим.
          if (plan.action === "push" && plan.withStatus === false && plan.mirrorRowId && at && (await syncDesk(at.pageId))) {
            let freshCopy: PageRow | null = null;
            let freshSource: PageRow | null = null;
            try {
              freshCopy = await sbFetchRowById(ws, at.pageId, at.tabId, at.rowId);
              if (freshCopy) freshSource = await sbFetchRowById(ws, cur.pageId, cur.subPageId, row.id);
            } catch {
              freshCopy = null;
            }
            if (!freshCopy || !freshSource) {
              // Не прочиталось или строки уже нет — «не узнали»: в этот проход
              // строку не трогаем, список заказов перечитаем.
              refresher.later();
              continue;
            }
            const want = buildMirrorCells({
              source: freshSource,
              osColumns: OS_COLUMNS,
              keys: target.keys,
              osNickValue: cur.osNickValue,
              status: "",
              withStatus: false,
              dateMs: 0,
            });
            if (copyHoldsMirror(freshCopy, want, target.keys.price, freshSource)) {
              // Значения уже те же (их привёз триггер базы) — копию не трогаем,
              // только подпись на источник: по ней проход и сравнивает поля.
              await sbPatchRow(ws, cur.pageId, cur.subPageId, row.id, { syncHash: mirrorSyncHash(want, freshSource.extras) });
              changed = true;
              continue;
            }
            // ОС и правда поменял поля — едут технарю, но по свежему источнику.
            sourceRow = freshSource;
            copyRow = freshCopy;
          }
          const pushed = await pushOrderToTech({
            workspaceId: cur.workspaceId,
            osUid: cur.osUid,
            osNickValue: cur.osNickValue,
            source: sourceRow,
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
            copy: plan.action === "push" && plan.mirrorRowId ? copyRow : undefined,
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
            // Прежнему технарю — одно уведомление: заказ ушёл к другому, а
            // его собственная строка осталась у него (авто-передача).
            if (returnedTo && returnedTo !== techUid && plan.removeAt && !told.current.has(`${row.id}:${plan.removeAt.rowId}:moved`)) {
              told.current.add(`${row.id}:${plan.removeAt.rowId}:moved`);
              const fromUid = cur.actorUid || cur.osUid;
              void sendNotification(
                {
                  workspaceId: ws,
                  title: `Заказ передали другому технарю${client ? `: ${client}` : ""}`,
                  body: `ОС ${osName} отдал заказ технарю ${name}. Ваша строка осталась у вас без ника ОС — удалите её, если она больше не нужна.`,
                  priority: "normal",
                  fromUid,
                  fromName: nameOf(fromUid, osName),
                  target: "selected",
                  selectedUids: [returnedTo],
                  pageId: plan.removeAt.pageId,
                  href: deskRowHref(plan.removeAt.pageId, plan.removeAt.tabId, plan.removeAt.rowId),
                },
                [returnedTo]
              ).catch(() => undefined);
            }
            // Заказ висел на бирже, а ОС отдал его сам — закрываем его там,
            // иначе технари продолжали бы откликаться на уже отданный заказ.
            // Только если он там ещё висит: снятый (отменённый) заказ
            // иначе воскрес бы в «В столах».
            if (row.orderId && onExchangeNow && !viaExchange) {
              void markOrderTaken(cur.workspaceId, row.orderId, {
                pageId: target.page.id,
                subPageId: plan.mirrorTabId ?? target.tabId,
                rowId: pushed.rowId,
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
