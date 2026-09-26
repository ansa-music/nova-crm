import type { PageColumn } from "@/types";
import { pickRowCardColumns } from "@/utils/rowCardColumns";

/**
 * Имя и телефон клиента из ячеек строки стола — для подписи привязки чата
 * Telegram к клиенту. Сначала по столбцам стола (тот же выбор, что у
 * «Карточек»: первый текстовый — клиент, столбец-телефон), а если ключей нет
 * (у месячной вкладки свои ключи) — по виду значений: похожее на телефон и
 * первое похожее на имя. Значения списков (`opt_…`, `resp_…`, `await_pay`)
 * именем не считаются.
 */

const OPTION_LIKE = /^[a-z0-9_:-]+$/;
const URL_LIKE = /^(https?:\/\/|www\.)/i;

function digitsOf(value: string): string {
  return value.replace(/\D/g, "");
}

export function looksLikePhone(value: string): boolean {
  const v = value.trim();
  if (!/^[+\d\s()\-.]+$/.test(v)) return false;
  const d = digitsOf(v);
  return d.length >= 10 && d.length <= 13;
}

function looksLikeName(value: string): boolean {
  const v = value.trim();
  if (v.length < 2 || v.length > 80) return false;
  if (!/\p{L}/u.test(v)) return false;
  if (OPTION_LIKE.test(v)) return false;
  if (URL_LIKE.test(v)) return false;
  return true;
}

export function clientNameAndPhone(cells: Record<string, string>, columns?: PageColumn[] | null): { name: string | null; phone: string | null } {
  let name: string | null = null;
  let phone: string | null = null;
  if (columns?.length) {
    const picked = pickRowCardColumns(columns);
    const titleValue = picked.title ? cells[picked.title.key]?.trim() : "";
    if (titleValue && looksLikeName(titleValue)) name = titleValue;
    const phoneValue = picked.phone ? cells[picked.phone.key]?.trim() : "";
    if (phoneValue) phone = phoneValue;
  }
  const values = Object.values(cells)
    .map((v) => String(v ?? "").trim())
    .filter(Boolean);
  if (!phone) phone = values.find(looksLikePhone) ?? null;
  if (!name) name = values.find((v) => looksLikeName(v) && !looksLikePhone(v)) ?? null;
  return { name, phone };
}

/** «Имя · телефон» — подпись привязки (≤ 200 знаков, как в базе). */
export function clientLabelOf(name: string | null, phone: string | null): string {
  return [name, phone].filter(Boolean).join(" · ").slice(0, 200) || "Клиент без имени";
}
