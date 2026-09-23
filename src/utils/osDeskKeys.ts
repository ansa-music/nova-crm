import type { PageColumn } from "@/types";

/** Ключи ячеек стола ОС: чем проход, выдача и биржа читают строку. */
export interface OsDeskKeys {
  client: string;
  phone: string;
  price: string;
  upsell: string;
  note: string;
  link: string;
  status: string;
  technician: string;
}

/** Ключи нового стола ОС — от `OS_DESK_COLUMNS`. */
export const OS_DESK_KEYS: OsDeskKeys = {
  client: "client",
  phone: "phone",
  price: "price",
  upsell: "upsell",
  note: "note",
  link: "link",
  status: "status",
  technician: "technician",
};

/**
 * Ключи ОТКРЫТОЙ таблицы стола ОС. У стола, заведённого сервисом, они
 * фиксированные, но столбец мог завести и сам ОС (свой «Статус» до того, как
 * его стали дописывать, вкладка с переименованными столбцами) — тогда ключ
 * случайный, и проход, читающий `cells.status`, видел пустоту: статус у ОС
 * меняли, а технарю ничего не уезжало. Сначала ключ по умолчанию, потом тип,
 * потом название.
 */
export function resolveOsDeskKeys(columns: readonly PageColumn[] | null | undefined): OsDeskKeys {
  if (!columns?.length) return OS_DESK_KEYS;
  const byKey = (key: string) => columns.find((c) => c.key === key)?.key;
  const byType = (type: PageColumn["type"]) => columns.find((c) => c.type === type)?.key;
  const byLabel = (re: RegExp) => columns.find((c) => re.test((c.label ?? "").trim()))?.key;
  return {
    client: byKey("client") ?? byLabel(/^(имя|клиент|фио)/i) ?? columns[0].key,
    phone: byKey("phone") ?? byType("phone") ?? byLabel(/номер|телефон/i) ?? OS_DESK_KEYS.phone,
    price: byKey("price") ?? byLabel(/^(цена|сумма|стоимость)/i) ?? OS_DESK_KEYS.price,
    upsell: byKey("upsell") ?? byLabel(/апсейл|upsell/i) ?? OS_DESK_KEYS.upsell,
    note: byKey("note") ?? byLabel(/примеч|коммент/i) ?? OS_DESK_KEYS.note,
    link: byKey("link") ?? byType("url") ?? OS_DESK_KEYS.link,
    // Статус и технарь — по ТИПУ раньше ключа: «Статус» стол держит ровно один.
    status: byType("status") ?? OS_DESK_KEYS.status,
    technician: byType("technician") ?? OS_DESK_KEYS.technician,
  };
}
