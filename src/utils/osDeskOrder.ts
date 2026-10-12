import { approvalStatusValue } from "@/utils/columnOptions";
import { normalizeNumericInput, parseLooseNumber } from "@/utils/numberInput";
import { parseDateInput } from "@/utils/osDates";
import { resolveOsDeskKeys } from "@/utils/osDeskKeys";
import { paymentPatch } from "@/utils/payment";
import { normalizeRowExtras, type RowExtras } from "@/utils/rowExtras";
import type { PageColumn, PaymentMethod, StatusOption } from "@/types";

/**
 * Форма «Новый заказ» стола ОС (просьба Nurba 13.10.2026: «в столах ОС при
 * добавлении заказа визитка не отображает все данные для заполнения»).
 * Раньше на столе ОС открывался «Быстрый заказ» стола технаря — с «ОС» и
 * «Чеком», но без апсейла, способов оплаты, ссылки и дедлайна. Поля — те же,
 * что у «Нового клиента» на «Общей таблице» (`NewLeadDialog`), без выбора ОС.
 */
export interface OsDeskOrderForm {
  client: string;
  phone: string;
  price: string;
  upsell: string;
  pricePay: PaymentMethod | null;
  upsellPay: PaymentMethod | null;
  link: string;
  persons: string;
  minutes: string;
  /** `yyyy-mm-dd` из поля даты, пусто — без дедлайна. */
  deadline: string;
  note: string;
}

export const EMPTY_OS_DESK_ORDER: OsDeskOrderForm = {
  client: "",
  phone: "",
  price: "",
  upsell: "",
  pricePay: null,
  upsellPay: null,
  link: "",
  persons: "",
  minutes: "",
  deadline: "",
  note: "",
};

/** Сумма вписана, но не разбирается как число — в ячейку лёг бы текст. */
export function osDeskAmountBad(raw: string): boolean {
  return Boolean(raw.trim()) && parseLooseNumber(raw) == null;
}

/** Чего не хватает, чтобы записать заказ; null — можно писать. */
export function osDeskOrderMissing(form: OsDeskOrderForm): string | null {
  if (!form.client.trim()) return "Впишите имя клиента";
  if (osDeskAmountBad(form.price)) return "Цена — только цифры";
  if (osDeskAmountBad(form.upsell)) return "Апсейл — только цифры";
  return null;
}

/**
 * Ячейки и визитка строки стола ОС. Как `addOsDeskOrderRow` + `addLead`:
 * статус — «Утверждение» (выдать можно только такой заказ), способ оплаты
 * пишется вместе со снимком комиссии. «Итого» и дату получения не пишем —
 * их ставит сам стол (`useOsTotalsKeeper`, `osReceivedAt`).
 */
export function buildOsDeskOrderRow(
  columns: readonly PageColumn[],
  form: OsDeskOrderForm,
  statusOptions: readonly StatusOption[]
): { cells: Record<string, string | number | null>; extras: RowExtras | null } {
  const k = resolveOsDeskKeys(columns);
  const has = (key: string) => columns.some((c) => c.key === key);
  const cells: Record<string, string | number | null> = {};
  cells[k.client] = form.client.trim();
  if (form.phone.trim() && has(k.phone)) cells[k.phone] = form.phone.trim();
  const price = form.price.trim() ? normalizeNumericInput(form.price) : "";
  const upsell = form.upsell.trim() ? normalizeNumericInput(form.upsell) : "";
  if (price && has(k.price)) {
    cells[k.price] = price;
    if (form.pricePay) Object.assign(cells, paymentPatch(k.price, form.pricePay));
  }
  if (upsell && has(k.upsell)) {
    cells[k.upsell] = upsell;
    if (form.upsellPay) Object.assign(cells, paymentPatch(k.upsell, form.upsellPay));
  }
  const link = form.link.trim();
  const linkInCell = Boolean(link) && has(k.link);
  if (linkInCell) cells[k.link] = link;
  if (has(k.status)) cells[k.status] = approvalStatusValue(statusOptions);
  const extras = normalizeRowExtras({
    persons: parseLooseNumber(form.persons),
    minutes: parseLooseNumber(form.minutes),
    note: form.note,
    // Столбца «Ссылка» нет — ссылка остаётся в визитке, а не теряется.
    link: linkInCell ? "" : link,
    deadline: form.deadline ? parseDateInput(form.deadline) : null,
  });
  return { cells, extras };
}
