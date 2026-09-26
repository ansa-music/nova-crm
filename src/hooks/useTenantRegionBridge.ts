import { useEffect } from "react";
import { supabaseRows } from "@/lib/supabaseRows";
import { isSbMissingError } from "@/services/sb/sbCollections";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { DEFAULT_TIMEZONE, setUserTimeZone } from "@/utils/date";
import { DEFAULT_CURRENCY, setAppCurrency } from "@/utils/format";

const DEFAULT_LOCALE = "ru-KZ";

/**
 * Регион компании (SaaS этап 1) — из документа workspace в модули дат и денег.
 *
 * Ставится ПРИ ОТРИСОВКЕ, а не эффектом: страницы рисуются после AppLayout и
 * должны сразу считать дни в поясе компании. Нет поля `region` — Алматы и
 * тенге, как было зашито, то есть у нынешних людей ничего не меняется.
 *
 * Сессия настоящего Owner заодно сверяет копию региона в Supabase
 * (`rows_workspaces`, по ней считает дни SQL — `rows_tz`): раз на загрузку,
 * только когда строки живут в Supabase; нет функции или столбцов (SQL ещё
 * не накатан) — молча ничего.
 */
export function useTenantRegionBridge(upkeepOwner: boolean) {
  const ws = useWorkspaceStore((s) => s.workspaces.find((w) => w.id === s.activeWorkspaceId) ?? null);
  const id = ws?.id ?? null;
  const timeZone = ws?.region?.timeZone || DEFAULT_TIMEZONE;
  const currency = ws?.region?.currency || DEFAULT_CURRENCY;
  const locale = ws?.region?.locale || DEFAULT_LOCALE;
  const inSupabase = ws?.rowsBackend === "supabase";

  setUserTimeZone(timeZone);
  setAppCurrency(currency);

  useEffect(() => {
    if (!id || !upkeepOwner || !inSupabase) return;
    const key = `${id}|${timeZone}|${currency}|${locale}`;
    if (reconciled.has(key)) return;
    reconciled.add(key);
    void reconcileRegion(id, timeZone, currency, locale).catch((error) => {
      reconciled.delete(key);
      console.warn("[region] сверка региона с Supabase не удалась", error);
    });
  }, [id, upkeepOwner, inSupabase, timeZone, currency, locale]);
}

const reconciled = new Set<string>();

async function reconcileRegion(workspaceId: string, timeZone: string, currency: string, locale: string) {
  const { data, error } = await supabaseRows
    .from("rows_workspaces")
    .select("timezone,currency,locale")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) {
    if (isSbMissingError(error)) return;
    throw error;
  }
  if (!data) return;
  const row = data as { timezone?: string; currency?: string; locale?: string };
  if (row.timezone === timeZone && row.currency === currency && row.locale === locale) return;
  const { error: writeError } = await supabaseRows.rpc("rows_set_tenant_region", {
    p_workspace: workspaceId,
    p_timezone: timeZone,
    p_currency: currency,
    p_locale: locale,
  });
  if (writeError && !isSbMissingError(writeError)) throw writeError;
}
