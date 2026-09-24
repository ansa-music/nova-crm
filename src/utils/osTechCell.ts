import { isApprovalStatusValue } from "@/utils/columnOptions";
import { formatDayMonth } from "@/utils/osDates";
import type { TechIdentity } from "@/utils/techIdentity";
import type { PageRow, StatusOption } from "@/types";

/**
 * Ячейка «Технарь» на столе ОС — ОДНА модель состояния на все экраны:
 * таблица, «Карточки» на телефоне и карточка строки (`OsOrderPanel`).
 *
 * Жалоба Nurba 24.09.2026: «непонятно, кто технарь и что нажимать». Было пять
 * входов с разными словами («В работу», «На «Заказы»», «Выдать заново»,
 * «Выбрать…», «Отдать заказ…»), карточка спорила с таблицей, а у выданного
 * заказа в ячейке не было ничего. Теперь у строки ровно одно состояние, одна
 * подпись и одно следующее действие; слева — кто (бейдж технаря) или что
 * (подпись), справа — чип действия. Решения — только здесь, по `kind`, а не
 * по тексту подписи.
 *
 * | kind       | когда                                                 | чип              |
 * |------------|-------------------------------------------------------|------------------|
 * | issue      | нет технаря, «Утверждение», на «Заказы» не выставлен  | «Выдать…»        |
 * | reissue    | то же, но прежний заказ сняли с «Заказов»             | «Выдать заново…» |
 * | give       | технарь намечен, «Утверждение», ещё не выдан          | «Отдать»         |
 * | pick       | нет технаря, статус не «Утверждение»                  | «Выбрать»        |
 * | waiting    | на «Заказах», откликов нет                            | «Отдать…»        |
 * | claims     | на «Заказах», есть отклики                            | «Выбрать»        |
 * | handoff    | отдан с «Заказов», едет к технарю                     | «едет»           |
 * | travelling | технарь выбран, заказ в работе, копии ещё нет         | «едет» (показ)   |
 * | with-tech  | копия у технаря, статусы сходятся                     | ✓ (показ)        |
 * | mismatch   | у технаря другой статус дольше 8 с                    | «Статус ≠»       |
 * | problem    | проход не может довезти заказ (причина — в подсказке; | «Не доехал»      |
 * |            | у невыданного «Утверждения» — только оборванная связь)|                  |
 * | loading    | ждём список «Заказов» или снятия заказа у технаря      | —                |
 */
export type OsTechCellKind =
  | "issue"
  | "reissue"
  | "give"
  | "pick"
  | "waiting"
  | "claims"
  | "handoff"
  | "travelling"
  | "with-tech"
  | "mismatch"
  | "problem"
  | "loading";

/** Один акцент на весь стол: действие, нейтрально, внимание, «всё хорошо». */
export type OsTechChipTone = "action" | "neutral" | "warning" | "success";
export type OsTechIcon = "send" | "store" | "alert" | "hand" | "check" | "user";

/**
 * Что делает нажатие:
 * - `choice` — «Как выдать?» (всем на «Заказы» или одному технарю);
 * - `picker-give` — список технарей, выбор = выдача;
 * - `picker-change` — список технарей, сменить (заказ переедет);
 * - `give` — статус «В работе», заказ уедет намеченному технарю;
 * - `exchange-picker` — отклики на «Заказах» (или отдать напрямую);
 * - `handoff-toast` / `problem-toast` / `loading-toast` — объяснить тостом;
 * - `push-status` — отправить статус ОС в копию технаря;
 * - `none` — ничего.
 */
export type OsTechAction =
  | "choice"
  | "picker-give"
  | "picker-change"
  | "give"
  | "exchange-picker"
  | "handoff-toast"
  | "problem-toast"
  | "loading-toast"
  | "push-status"
  | "none";

export type OsTechLeft =
  | { type: "badge"; identity: TechIdentity | null }
  | { type: "text"; text: string; tone: "muted" | "warning" | "primary"; icon: "store" | "hand" | null };

export interface OsTechChip {
  label: string;
  tone: OsTechChipTone;
  icon: OsTechIcon | null;
  /** Только показ («едет», ✓): не кнопка, нажатие уходит в саму ячейку. */
  passive?: boolean;
}

export interface OsTechCellState {
  kind: OsTechCellKind;
  left: OsTechLeft;
  chip: OsTechChip | null;
  /** Подсказка ячейки и чипа — что происходит и что даст нажатие. */
  title: string;
  /** Нажатие на чип. */
  chipAction: OsTechAction;
  /** Нажатие на саму ячейку (Enter по ячейке — то же). */
  bodyAction: OsTechAction;
  /** Статус заказа у технаря (значение), если копия прочитана. */
  theirStatus: string | null;
  /** Заказ на «Заказах» (для откликов). */
  exchangeId: string | null;
}

/** Заказ строки на «Заказах» — ровно то, что нужно ячейке. */
export interface OsTechExchange {
  id: string;
  status: string;
  /** Сколько технарей откликнулось. */
  claims: number;
  assignedName?: string | null;
}

export interface OsTechCellInput {
  row: Pick<PageRow, "id" | "cells" | "orderId" | "mirrorRowId" | "mirrorPageId" | "updatedAt">;
  keys: { client: string; technician: string; status: string };
  statusOptions: readonly StatusOption[];
  /** Копия заказа у технаря (`useMyOrderRows().bySource`). */
  mirror: Pick<PageRow, "cells" | "statusKey"> | null;
  /** Список копий ещё читается — статус технаря не сравниваем. */
  mirrorsLoading?: boolean;
  /** Почему проход не может довезти заказ (`useOsDeskDispatch().problems`). */
  problem?: string | null;
  exchange?: OsTechExchange | null;
  /** Свои заказы на «Заказах» прочитаны с сервера. */
  exchangeLoaded: boolean;
  /** Технарь строки (ник из столбца «Технарь»). */
  identity: TechIdentity | null;
  /** Кому отдан заказ с «Заказов» (ника в строке ещё нет). */
  assignedIdentity?: TechIdentity | null;
  /** Когда выдан (для подсказки «у технаря с 24.09»). */
  issuedAt?: number | null;
  now: number;
}

/** Через сколько после правки строки разный статус — уже «не совпал». */
export const OS_MISMATCH_SETTLE_MS = 8_000;

/**
 * Связь с копией оборвана: заказ вернули технарю на «Правке столов» (или
 * копию удалили у него) — адреса нет, в `osLostFor` ник этого же технаря.
 * Раньше такая строка молчала: ник и дата «выдан» на месте, а статус к
 * технарю не уходил (жалоба Nurba 24.09.2026). Метку ставит проход стола ОС
 * (`useOsDeskDispatch`), рисует стол.
 */
export const OS_DEAD_LINK_PROBLEM =
  "Заказ вернули технарю («Правка столов» → «Вернуть») или удалили у него — статус к нему больше не уходит";

function cellText(cells: PageRow["cells"], key: string | null | undefined): string {
  const v = key ? cells[key] : null;
  return v === null || v === undefined ? "" : String(v).trim();
}

/** Подпись статуса по значению (как в выпадашке). */
export function osStatusLabel(value: string, options: readonly StatusOption[]): string {
  return options.find((o) => o.value === value)?.label ?? value;
}

/**
 * Состояние ячейки «Технарь». `null` — строка ещё не заказ (нет клиента):
 * ячейка тогда обычная.
 */
export function osTechCellState(input: OsTechCellInput): OsTechCellState | null {
  const { row, keys, statusOptions } = input;
  if (!cellText(row.cells, keys.client)) return null;
  const tech = cellText(row.cells, keys.technician);
  const status = cellText(row.cells, keys.status);
  const onApproval = isApprovalStatusValue(status, statusOptions);
  const mirror = input.mirror ?? null;
  const dispatched = Boolean(mirror || (row.mirrorRowId && row.mirrorPageId));
  const theirStatus = mirror?.statusKey && !input.mirrorsLoading ? cellText(mirror.cells, mirror.statusKey) : null;
  const who = input.identity?.label ?? null;
  const badge: OsTechLeft = { type: "badge", identity: input.identity };
  const base = { theirStatus, exchangeId: null as string | null };

  if (tech) {
    const problem = input.problem?.trim();
    // Причина «не доехал» сильнее «Отдать», только когда она про выдачу:
    // заказ уже у технаря, должен к нему ехать (не «Утверждение») или связь с
    // копией оборвана. У невыданного заказа на «Утверждении» старая причина
    // («нет вкладки месяца» до того, как ОС вернул «Утверждение») прятала бы
    // «Отдать», а «Выдать заново» в карточке увозило бы технарю заказ на
    // утверждении.
    if (problem && (dispatched || !onApproval || problem === OS_DEAD_LINK_PROBLEM)) {
      return {
        ...base,
        kind: "problem",
        left: badge,
        chip: { label: "Не доехал", tone: "warning", icon: "alert" },
        title: `Заказ не доходит до технаря: ${problem}`,
        chipAction: "problem-toast",
        bodyAction: "picker-change",
      };
    }
    if (!dispatched && onApproval) {
      return {
        ...base,
        kind: "give",
        left: badge,
        chip: { label: "Отдать", tone: "action", icon: "send" },
        title: `Отдать ${who ?? "технарю"}: статус станет «В работе», заказ уедет в его стол`,
        chipAction: "give",
        bodyAction: "picker-give",
      };
    }
    if (!dispatched) {
      return {
        ...base,
        kind: "travelling",
        left: badge,
        chip: { label: "едет", tone: "neutral", icon: null, passive: true },
        title: `Заказ едет к ${who ?? "технарю"} — через секунду будет в его столе`,
        chipAction: "none",
        bodyAction: "picker-change",
      };
    }
    const settled = input.now - (row.updatedAt ?? 0) > OS_MISMATCH_SETTLE_MS;
    if (theirStatus !== null && status && theirStatus !== status && !onApproval && settled) {
      const theirs = theirStatus ? osStatusLabel(theirStatus, statusOptions) : "без статуса";
      return {
        ...base,
        kind: "mismatch",
        left: badge,
        chip: { label: "Статус ≠", tone: "warning", icon: "alert" },
        title: `У технаря «${theirs}», у вас «${osStatusLabel(status, statusOptions)}». Нажмите — отправить ваш`,
        chipAction: "push-status",
        bodyAction: "picker-change",
      };
    }
    const since = input.issuedAt ? ` с ${formatDayMonth(input.issuedAt)}` : "";
    const theirs = theirStatus ? `. У технаря статус «${osStatusLabel(theirStatus, statusOptions)}»` : "";
    return {
      ...base,
      kind: "with-tech",
      left: badge,
      chip: { label: "", tone: "success", icon: "check", passive: true },
      title: `Заказ у ${who ?? "технаря"}${since}${theirs}`,
      chipAction: "none",
      bodyAction: "picker-change",
    };
  }

  // Технаря стёрли, а копия ещё есть — проход вот-вот заберёт заказ у технаря.
  if (dispatched) {
    return {
      ...base,
      kind: "loading",
      left: { type: "text", text: "снимаем…", tone: "muted", icon: null },
      chip: null,
      title: "Технаря стёрли — заказ убирается из его стола",
      chipAction: "none",
      bodyAction: "loading-toast",
    };
  }

  const ex = input.exchange ?? null;
  if (ex && ex.status === "assigned") {
    return {
      ...base,
      exchangeId: ex.id,
      kind: "handoff",
      left: input.assignedIdentity
        ? { type: "badge", identity: input.assignedIdentity }
        : { type: "text", text: ex.assignedName?.trim() || "технарю", tone: "primary", icon: null },
      chip: { label: "едет", tone: "neutral", icon: null },
      title: "Отдан с «Заказов» — ник появится в строке сам, как только заказ доедет",
      chipAction: "handoff-toast",
      bodyAction: "handoff-toast",
    };
  }
  if (ex) {
    if (ex.claims > 0) {
      return {
        ...base,
        exchangeId: ex.id,
        kind: "claims",
        left: { type: "text", text: `отклики: ${ex.claims}`, tone: "primary", icon: "hand" },
        chip: { label: "Выбрать", tone: "action", icon: null },
        title: `Откликнулись: ${ex.claims}. Нажмите — выбрать технаря (или «Рандом»)`,
        chipAction: "exchange-picker",
        bodyAction: "exchange-picker",
      };
    }
    return {
      ...base,
      exchangeId: ex.id,
      kind: "waiting",
      left: { type: "text", text: "ждём отклики", tone: "muted", icon: "store" },
      chip: { label: "Отдать…", tone: "neutral", icon: null },
      title: "Заказ на «Заказах», технари получили уведомление. Нажмите — отдать напрямую, не дожидаясь отклика",
      chipAction: "exchange-picker",
      bodyAction: "exchange-picker",
    };
  }
  // Свои заказы на «Заказах» ещё не прочитаны — строка с заказом считается
  // висящей там: иначе кнопка выставила бы её второй раз.
  if (row.orderId && !input.exchangeLoaded) {
    return {
      ...base,
      kind: "loading",
      left: { type: "text", text: "на «Заказах»…", tone: "muted", icon: "store" },
      chip: null,
      title: "Свои заказы на «Заказах» ещё читаются",
      chipAction: "none",
      bodyAction: "loading-toast",
    };
  }
  // Выдать можно только заказ НА УТВЕРЖДЕНИИ (правило Nurba 24.09.2026) —
  // впервые или заново, если прежний заказ сняли с «Заказов».
  if (onApproval) {
    if (row.orderId) {
      return {
        ...base,
        kind: "reissue",
        left: { type: "text", text: "снят", tone: "muted", icon: null },
        chip: { label: "Выдать заново…", tone: "action", icon: "send" },
        title: "Прежний заказ сняли с «Заказов». Выдайте снова — всем или одному технарю",
        chipAction: "choice",
        bodyAction: "choice",
      };
    }
    return {
      ...base,
      kind: "issue",
      left: { type: "text", text: "не выдан", tone: "muted", icon: null },
      chip: { label: "Выдать…", tone: "action", icon: "send" },
      title: "Заказ ещё не выдан. Выберите: всем технарям на «Заказы» или сразу одному технарю",
      chipAction: "choice",
      bodyAction: "choice",
    };
  }
  return {
    ...base,
    kind: "pick",
    left: { type: "text", text: "без технаря", tone: "warning", icon: null },
    chip: { label: "Выбрать", tone: "action", icon: "user" },
    title: "Технаря нет. Выберите — заказ уедет к нему сразу. На «Заказы» выставляется только заказ на «Утверждении»",
    chipAction: "picker-give",
    bodyAction: "picker-give",
  };
}

/** Заказ уже у технаря (есть копия или её адрес) — «Отметить «Готово»» имеет смысл. */
export function osRowIssued(row: Pick<PageRow, "mirrorRowId" | "mirrorPageId">, mirror: unknown): boolean {
  return Boolean(mirror || (row.mirrorRowId && row.mirrorPageId));
}
