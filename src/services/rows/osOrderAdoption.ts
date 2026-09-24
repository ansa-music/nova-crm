import { ensureOsDesk, findOsDeskOf, type OsDeskKeys } from "@/services/osDeskService";
import { fetchPagesFresh, updatePageOsFieldKeys } from "@/services/pageService";
import { fetchSubPageFresh } from "@/services/subPageService";
import { currentMonthKey, currentMonthSubPageId, isMonthlyDesk } from "@/services/monthTabService";
import { computeOsFieldKeys, sameOsFieldKeys } from "@/utils/osFieldKeys";
import { sbFetchAllPageRows, sbFetchRows, sbPatchRow } from "@/services/rows/supabaseRowStore";
import { usesSupabaseRows } from "@/services/rows/rowsBackend";
import { buildMirrorCells, mirrorSyncHash } from "@/services/rows/osOrderMirror";
import { openOsDeskCurrentTab, type OsDeskTab } from "@/services/rows/osDeskIssue";
import { sbFindDeskRowTab } from "@/services/rows/osOrderClaim";
import {
  OS_ISSUED_AT_KEY,
  OS_ISSUED_ON_KEY,
  OS_LOST_FOR_KEY,
  OS_RELEASED_FROM_KEY,
  OS_STATUS_SENT_KEY,
} from "@/utils/reservedCellKeys";
import { normalizeNumericInput } from "@/utils/numberInput";
import { isBlankRow } from "@/utils/blankRow";
import { personLabel } from "@/utils/peopleDesks";
import type { OsFieldKeys, PageRow, WorkspaceMember, WorkspacePage } from "@/types";

/**
 * Перенос уже заведённых заказов под управление ОС (разово, Owner).
 *
 * До этого заказы жили только в столах технарей, а ОС видел их лишь сводкой.
 * Теперь заказ ведёт ОС, поэтому у каждого заказа ТЕКУЩЕГО месяца, где указан
 * ник ОС, появляется строка-источник в столе этого ОС, а строка технаря
 * получает метку `osUid` — с этой минуты статус и сумму в ней меняет ОС.
 *
 * Границы (решение Nurba 23.09.2026):
 * - только текущий месяц; прошлые месяцы остаются историей технаря;
 * - строки без ника ОС не трогаем — они остаются полностью его;
 * - ник ОС без живого аккаунта пропускаем: писать заказ некому.
 *
 * Идемпотентно: id строки-источника выведен из id строки технаря, повторный
 * запуск обновит те же строки, а не размножит их.
 */

export interface OsAdoptionReport {
  /** Столов просмотрено (из скольких — `deskTotal`). */
  desks: number;
  /** Сколько столов подходило под перенос вообще. */
  deskTotal: number;
  /** Столов, которым Owner записал карту столбцов вместо них. */
  publishedKeys: number;
  adopted: number;
  alreadyManaged: number;
  skippedNoOs: number;
  skippedNoAccount: number;
  /** Ники ОС, за которыми нет живого аккаунта — их закрепляют на «Команде». */
  unknownOsNicks: string[];
  createdOsDesks: number;
  errors: string[];
}

export interface OsAdoptionProgress {
  done: number;
  total: number;
  label: string;
}

/** Строка-источник в столе ОС выводится из строки технаря — повтор не размножает. */
export function sourceRowIdFor(techRowId: string): string {
  return `adopt_${techRowId.replace(/[^A-Za-z0-9_-]/g, "")}`;
}

function cellText(row: PageRow, key: string | undefined): string {
  if (!key) return "";
  const value = row.cells[key];
  return value === null || value === undefined ? "" : String(value);
}

/** Строка-источник на столе ОС для заказа, записанного технарём. */
export interface ClaimSource {
  /** Ячейки — под НАСТОЯЩИМИ ключами столбцов вкладки стола ОС. */
  cells: Record<string, string>;
  /** Визитка — как у строки технаря. */
  extras: PageRow["extras"] | null;
  /** Подпись полей — ровно та, что посчитает проход стола ОС по этой строке. */
  syncHash: string;
  /** Дата заказа у технаря: max(createdAt, filledAt) (нет — сейчас). */
  orderAt: number;
}

/**
 * Строка-источник для заказа, который записал ТЕХНАРЬ (или любой человек у
 * себя в столе) с ником ОС: разовый перенос Owner (`adoptOrdersToOsDesks`) и
 * автоматический «забор» сессией ОС (`useOsOrderClaims`) собирают её здесь,
 * одинаково.
 *
 * Ключи ячеек — от настоящих столбцов вкладки стола ОС (`resolveOsDeskKeys`
 * той вкладки, куда ляжет строка, — `openOsDeskCurrentTab`). Раньше перенос
 * писал в фиксированные «client/phone/price/status», и на столе со своими
 * столбцами значения уезжали мимо, а подпись не совпадала с подписью прохода —
 * и первый же проход «исправлял» технарю его поля.
 *
 * Подпись — ТА ЖЕ, что считает проход стола ОС (`planOsDispatch`: только
 * поля, без статуса и даты, ключи технаря — карта его стола): иначе первый же
 * проход счёл бы заказ правкой ОС и переслал бы его технарю ещё раз.
 */
export function buildClaimSource(input: {
  techRow: PageRow;
  /** Карта столбцов вкладки технаря (`page.osFieldKeys` той вкладки, где строка). */
  techKeys: OsFieldKeys;
  /** Ключи вкладки стола ОС, куда ляжет строка-источник. */
  osKeys: OsDeskKeys;
  /** Ник ОС — он и так стоит у технаря в столбце ОС; входит в подпись. */
  osNickValue: string;
  /** Ник технаря — в столбец «Технарь» стола ОС. */
  techNick: string;
}): ClaimSource {
  const { techRow: row, techKeys: keys, osKeys } = input;
  const orderAt = Math.max(row.createdAt || 0, row.filledAt || 0) || Date.now();
  const cells: Record<string, string> = {};
  const put = (key: string | undefined, value: string) => {
    if (key && value) cells[key] = value;
  };
  put(osKeys.client, cellText(row, keys.client).trim());
  put(osKeys.phone, cellText(row, keys.phone).trim());
  // Цена у технаря — это уже сумма заказа; апсейл отдельной цифрой ОС
  // проставит сам, разделить задним числом нельзя.
  const price = cellText(row, keys.price).trim();
  put(osKeys.price, price ? normalizeNumericInput(price) : "");
  put(osKeys.link, cellText(row, keys.link).trim());
  put(osKeys.note, String(row.extras?.note ?? "").trim());
  put(osKeys.technician, input.techNick);
  // Заказ лежал у технаря с самого начала — «выдан» тогда же (столбец «Даты»).
  cells[OS_ISSUED_AT_KEY] = String(orderAt);
  // Заказ снова связан — отметка «у этого технаря забрали» больше не про него.
  cells[OS_LOST_FOR_KEY] = "";
  // Статус технаря — сразу и в столбец ОС, и как «синхронизированный»:
  // проходу тогда нечего ни тянуть, ни слать.
  const techStatus = cellText(row, keys.status).trim();
  if (techStatus) {
    cells[osKeys.status] = techStatus;
    cells[OS_STATUS_SENT_KEY] = techStatus;
  }
  const source = { id: "", pageId: "", cells, extras: row.extras, order: 0, createdAt: orderAt, updatedAt: orderAt } as PageRow;
  const syncHash = mirrorSyncHash(
    buildMirrorCells({
      source,
      osColumns: {
        client: osKeys.client,
        phone: osKeys.phone,
        price: osKeys.price,
        upsell: osKeys.upsell,
        note: osKeys.note,
        link: osKeys.link,
      },
      keys,
      osNickValue: input.osNickValue,
      status: "",
      withStatus: false,
      dateMs: 0,
    }),
    row.extras
  );
  return { cells, extras: row.extras ?? null, syncHash, orderAt };
}

/**
 * Карта столбцов месячной вкладки чужого стола.
 *
 * Обычно её публикует сессия САМОГО технаря (`useOsFieldKeysPublisher`), но
 * ждать, пока полтора десятка человек откроют свои столы, нельзя: без карты
 * ОС не может ни выдать заказ, ни забрать старый. Owner читает подвкладки
 * любого стола и пишет документ стола, поэтому карту он считает и
 * записывает сам — теми же правилами (`computeOsFieldKeys`), что и хозяин
 * стола, и только когда она отличается от записанной.
 */
async function ensureOsFieldKeys(
  workspaceId: string,
  page: WorkspacePage,
  tabId: string
): Promise<{ keys: OsFieldKeys; published: boolean }> {
  const current = page.osFieldKeys;
  // Записанная карта годится, только если она от ЭТОЙ вкладки И в ней есть
  // столбец ОС: по нему и определяется владелец заказа. Карта без него
  // попадает в базу штатно (стол без «Ответственного», вкладка, размеченная
  // по столбцам «Основной»), и раньше такой стол молча отчитывался «все
  // заказы без ника ОС» — Owner шёл искать ники, которых не теряли.
  if (current && current.tabId === tabId && current.os) return { keys: current, published: false };

  const tab = await fetchSubPageFresh(workspaceId, page.id, tabId);
  if (!tab) throw new Error("вкладка текущего месяца не нашлась — пусть стол откроют и повторите");
  const keys = computeOsFieldKeys(tabId, tab.columns ?? [], Date.now());
  if (!keys.os) {
    throw new Error("в этой вкладке нет столбца «Ответственный» — заказы стола НЕ проверялись");
  }
  if (sameOsFieldKeys(current, keys)) return { keys, published: false };
  await updatePageOsFieldKeys(workspaceId, page.id, keys);
  return { keys, published: true };
}

export async function adoptOrdersToOsDesks(input: {
  workspaceId: string;
  members: readonly WorkspaceMember[];
  /** Только эти столы («Передать ОС» у одного технаря на «Правке столов»); нет — все. */
  pageIds?: readonly string[];
  onProgress?: (p: OsAdoptionProgress) => void;
}): Promise<OsAdoptionReport> {
  const { workspaceId, members } = input;
  const report: OsAdoptionReport = {
    desks: 0,
    deskTotal: 0,
    publishedKeys: 0,
    adopted: 0,
    alreadyManaged: 0,
    skippedNoOs: 0,
    skippedNoAccount: 0,
    unknownOsNicks: [],
    createdOsDesks: 0,
    errors: [],
  };
  if (!usesSupabaseRows(workspaceId)) {
    throw new Error("Заказы переносятся только когда строки живут в Supabase");
  }

  // Список столов — СВЕЖИЙ с сервера: неполный список молча оставил бы часть
  // заказов у технарей (урок прошлого переноса).
  const pages = await fetchPagesFresh(workspaceId);
  // Вкладка ТЕКУЩЕГО месяца — только та, что `currentMonthSubPageId` считает
  // текущей (сверка с autoMonthKey). Голый autoMonthSubPageId у отставшего
  // стола указывает на прошлый месяц: Owner записал бы ему карту от старой
  // вкладки, и заказы уехали бы в её ключи.
  const monthKey = currentMonthKey();
  // Круг столов — тот же, что у автопилота месячных вкладок (`isMonthlyDesk`):
  // стол Admin или дашборд месячных вкладок не имеют вовсе, и жаловаться на
  // них в отчёте — шум, за которым не видно настоящих отставших столов.
  const only = input.pageIds ? new Set(input.pageIds) : null;
  const candidates = pages.filter(
    (p) => !p.osDesk && !p.inactive && p.responsibleUserId && isMonthlyDesk(p, [...members]) && (!only || only.has(p.id))
  );
  const techDesks = candidates.filter((p) => currentMonthSubPageId(p, monthKey));
  for (const stale of candidates.filter((p) => !currentMonthSubPageId(p, monthKey))) {
    report.errors.push(
      `«${stale.name}»: вкладка этого месяца ещё не заведена — заказы стола НЕ проверялись, пусть его откроют`
    );
  }
  report.deskTotal = techDesks.length;
  const unknownNicks = new Set<string>();
  const osDeskByUid = new Map<string, WorkspacePage>();
  /** Вкладка текущего месяца стола ОС (как её откроет сам стол) — по uid ОС. */
  const osTabByUid = new Map<string, OsDeskTab>();
  for (const page of pages) if (page.osDesk && page.responsibleUserId) osDeskByUid.set(page.responsibleUserId, page);

  let done = 0;
  for (const page of techDesks) {
    done += 1;
    input.onProgress?.({ done, total: techDesks.length, label: page.name });
    const tabId = currentMonthSubPageId(page, monthKey) as string;
    // Без ника технаря на «Команде» переносить нельзя: в столбце «Технарь» у
    // ОС было бы пусто, и первый же проход стола ОС УДАЛИЛ бы строку технаря
    // как «заказ, у которого стёрли технаря».
    const techNickOfDesk = members.find((m) => m.uid === page.responsibleUserId)?.techNickValue ?? "";
    if (!techNickOfDesk) {
      report.errors.push(`«${page.name}»: у технаря нет ника — закрепите ник на «Команде» и повторите`);
      continue;
    }
    let keys: OsFieldKeys;
    try {
      const ensured = await ensureOsFieldKeys(workspaceId, page, tabId);
      keys = ensured.keys;
      if (ensured.published) report.publishedKeys += 1;
    } catch (error) {
      report.errors.push(`«${page.name}»: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    report.desks += 1;

    let rows: PageRow[];
    try {
      rows = await sbFetchRows(workspaceId, page.id, tabId);
    } catch (error) {
      report.errors.push(`«${page.name}»: строки не прочитались — ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    for (const row of rows) {
      if (isBlankRow(row)) continue;
      if (row.osUid) {
        report.alreadyManaged += 1;
        continue;
      }
      const osValue = cellText(row, keys.os);
      if (!osValue) {
        report.skippedNoOs += 1;
        continue;
      }
      const osMember = members.find((m) => m.status === "active" && m.osNickValue === osValue && m.uid);
      if (!osMember?.uid) {
        // Имя ника в отчёт: иначе «пропущено 9» — это девять заказов, про
        // которые непонятно, что чинить. Чинится закреплением ника на «Команде».
        report.skippedNoAccount += 1;
        unknownNicks.add(osValue);
        continue;
      }

      // Стола ОС может ещё не быть — заводим (это делает Owner).
      let osDesk = osDeskByUid.get(osMember.uid) ?? findOsDeskOf(pages, osMember.uid);
      if (!osDesk) {
        try {
          osDesk = await ensureOsDesk({ workspaceId, uid: osMember.uid, name: personLabel(osMember) });
          osDeskByUid.set(osMember.uid, osDesk);
          report.createdOsDesks += 1;
        } catch (error) {
          report.errors.push(`Стол ОС для «${personLabel(osMember)}» не завёлся — ${error instanceof Error ? error.message : String(error)}`);
          continue;
        }
      }

      // Источник — во вкладку ТЕКУЩЕГО месяца стола ОС, ту же, что откроет
      // сам стол (`openOsDeskCurrentTab`: первый месяц — «Основная» под именем
      // месяца, дальше — вкладка месяца): ОС открывает стол на текущем месяце,
      // и заказ должен быть перед глазами. Ключи ячеек — от её столбцов.
      let osTab = osTabByUid.get(osMember.uid);
      if (!osTab) {
        try {
          osTab =
            (await openOsDeskCurrentTab({
              workspaceId,
              uid: osMember.uid,
              name: personLabel(osMember),
              osDesks: [osDesk],
              createIfMissing: false,
            })) ?? undefined;
        } catch (error) {
          report.errors.push(`Стол ОС «${personLabel(osMember)}»: вкладка месяца не открылась — ${error instanceof Error ? error.message : String(error)}`);
          continue;
        }
        if (!osTab) continue;
        osTabByUid.set(osMember.uid, osTab);
      }

      const techNick = techNickOfDesk;
      // Заказ, который ОС сам выдал, а Owner вернул технарю («Вернуть» на
      // «Правке столов»): у строки технаря id копии `os_<источник>`, и на столе
      // ОС жива ИСХОДНАЯ строка (с `osLostFor`). Подключаем её, а не заводим
      // рядом вторую `adopt_os_…` — иначе у ОС заказ висел бы дважды. Исходной
      // строки нет (удалили) — как с обычной строкой технаря.
      let srcId = sourceRowIdFor(row.id);
      let srcTab: string | null = osTab.tabId;
      if (row.id.startsWith("os_") && row.id.length > 3) {
        const originalTab = await sbFindDeskRowTab(workspaceId, osDesk.id, row.id.slice(3)).catch(() => undefined);
        if (originalTab !== undefined) {
          srcId = row.id.slice(3);
          srcTab = originalTab || null;
        }
      }
      const src = buildClaimSource({
        techRow: row,
        techKeys: keys,
        osKeys: osTab.keys,
        osNickValue: osMember.osNickValue ?? "",
        techNick,
      });
      try {
        // 1. Строка-источник в столе ОС (адрес копии — на неё). Ячейки
        //    ложатся поверх (`rows_patch`): у подключённой заново исходной
        //    строки остаётся всё, что ОС вёл сам.
        await sbPatchRow(workspaceId, osDesk.id, srcTab, srcId, {
          cells: src.cells,
          extras: row.extras ?? undefined,
          updatedAt: src.orderAt,
          syncHash: src.syncHash,
          mirrorPageId: page.id,
          mirrorTabId: tabId,
          mirrorRowId: row.id,
        });
        // 2. Строка технаря переходит под управление ОС. Метку «Owner забрал
        //    у ОС» (`osReleasedFrom`, «Вернуть») снимаем: «Передать ОС» —
        //    и есть явный путь назад.
        await sbPatchRow(workspaceId, page.id, tabId, row.id, {
          cells: cellText(row, OS_RELEASED_FROM_KEY).trim() ? { [OS_RELEASED_FROM_KEY]: "" } : {},
          osUid: osMember.uid,
          techUid: page.responsibleUserId as string,
          // Только настоящий ключ столбца: по нему Тимлид получает право
          // поставить «Успешку», и выдуманный ключ дал бы право в никуда.
          statusKey: keys.status,
          syncHash: src.syncHash,
          srcPageId: osDesk.id,
          srcTabId: srcTab ?? "",
          srcRowId: srcId,
        });
        report.adopted += 1;
      } catch (error) {
        report.errors.push(`«${page.name}» / строка ${row.id} — ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  report.unknownOsNicks = [...unknownNicks].sort((a, b) => a.localeCompare(b, "ru"));
  return report;
}

/**
 * Снять управление со ВСЕХ заказов — аварийный выход, если ОС недоступен, а
 * заказы надо вести дальше. Строки остаются на месте и снова становятся
 * обычными строками технаря; строки-источники в столах ОС не трогаем — они
 * никому не мешают, а удалять чужие данные в аварийной кнопке нельзя.
 */
export async function releaseAllOrders(input: {
  workspaceId: string;
  /** Для уборки адресов у строк-источников ОС (ник технаря стола). */
  members?: readonly WorkspaceMember[];
  onProgress?: (p: OsAdoptionProgress) => void;
}): Promise<{ released: number; errors: string[] }> {
  const { workspaceId } = input;
  if (!usesSupabaseRows(workspaceId)) {
    throw new Error("Управление снимается только когда строки живут в Supabase");
  }
  const pages = await fetchPagesFresh(workspaceId);
  const desks = pages.filter((p) => !p.osDesk);
  const errors: string[] = [];
  let released = 0;
  let done = 0;
  for (const page of desks) {
    done += 1;
    input.onProgress?.({ done, total: desks.length, label: page.name });
    try {
      released += await releaseDeskOrders(workspaceId, page, techNickOf(input.members, page));
    } catch (error) {
      errors.push(`«${page.name}» — ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { released, errors };
}

/**
 * Снять управление со всех заказов стола — по ВСЕМ вкладкам, а не только по
 * текущему месяцу: заказ, выданный в сентябре, в октябре лежит в прошлой
 * вкладке, и аварийная кнопка обязана расстегнуть и его.
 */
export async function releaseDeskOrders(workspaceId: string, page: WorkspacePage, techNick = ""): Promise<number> {
  const byTab = await sbFetchAllPageRows(workspaceId, page.id);
  const osKeys = page.osFieldKeys;
  let released = 0;
  for (const [tabId, rows] of byTab) {
    for (const row of rows) {
      if (!row.osUid) continue;
      // Решение Owner — на САМОЙ строке технаря: ник ОС, у которого заказ
      // забрали (`osReleasedFrom`). Раньше его держала только строка-источник
      // ОС (`osLostFor`, без адреса), и стоило ОС удалить её или выдать
      // заказ другому, как забор (SQL 20261002) снова брал строку себе.
      // Только во вкладке, где забор ищет строки (вкладка карты столбцов
      // стола), и только если в строке есть ник ОС. Owner пишет мимо стража,
      // а до SQL 20261002 ячейка просто лежит без дела.
      const releasedFrom =
        osKeys?.os && (tabId || "") === (osKeys.tabId || "") ? cellText(row, osKeys.os).trim() : "";
      await sbPatchRow(workspaceId, page.id, tabId || null, row.id, {
        cells: releasedFrom ? { [OS_RELEASED_FROM_KEY]: releasedFrom } : {},
        releaseOrder: true,
      });
      released += 1;
      // У строки-источника ОС снимаем адрес копии и помечаем «у этого технаря
      // заказ забрали» (как при потере, `osLostFor`): иначе проход стола ОС
      // увидел бы пропавшую копию, показал бы ОС тост о потере, а заказ
      // «у того же технаря» считал бы выданным. Не вышло — не страшно: проход
      // сам придёт к тому же через ветку `lost`.
      // Даты «выдан» (авто и поставленную ОС) снимаем тоже, как ветка `lost`:
      // строка у ОС иначе выглядела бы выданной, хотя статус к технарю
      // больше не уходит.
      if (techNick && row.srcPageId && row.srcRowId) {
        await sbPatchRow(workspaceId, row.srcPageId, row.srcTabId || null, row.srcRowId, {
          cells: { [OS_LOST_FOR_KEY]: techNick, [OS_STATUS_SENT_KEY]: "", [OS_ISSUED_AT_KEY]: "", [OS_ISSUED_ON_KEY]: "" },
          clearMirror: true,
        }).catch(() => undefined);
      }
    }
  }
  return released;
}

function techNickOf(members: readonly WorkspaceMember[] | undefined, page: WorkspacePage): string {
  return members?.find((m) => m.uid === page.responsibleUserId)?.techNickValue ?? "";
}

export interface DeskOrderCounts {
  /** Заполненных строк во вкладке текущего месяца. */
  total: number;
  /** Строк-заказов под управлением ОС. */
  managed: number;
  /** Строк с ником ОС, которые ещё можно передать ОС; null — карта столбцов стола не от этой вкладки. */
  adoptable: number | null;
  /** Вкладки текущего месяца у стола ещё нет. */
  noMonthTab: boolean;
}

/**
 * Сколько заказов стола ведёт ОС и сколько ещё можно передать — для списка на
 * «Правке столов». Только вкладка ТЕКУЩЕГО месяца, строки — из Supabase
 * (квоту Firestore не тратит). Ник ОС ищется по карте столбцов стола
 * (`osFieldKeys`), и только если она от этой же вкладки.
 */
export async function countDeskOrders(workspaceId: string, page: WorkspacePage): Promise<DeskOrderCounts> {
  const tabId = currentMonthSubPageId(page, currentMonthKey());
  if (!tabId) return { total: 0, managed: 0, adoptable: null, noMonthTab: true };
  const rows = await sbFetchRows(workspaceId, page.id, tabId);
  const keys = page.osFieldKeys && page.osFieldKeys.tabId === tabId && page.osFieldKeys.os ? page.osFieldKeys : null;
  let total = 0;
  let managed = 0;
  let adoptable = 0;
  for (const row of rows) {
    if (isBlankRow(row)) continue;
    total += 1;
    if (row.osUid) managed += 1;
    else if (keys && cellText(row, keys.os)) adoptable += 1;
  }
  return { total, managed, adoptable: keys ? adoptable : null, noMonthTab: false };
}
