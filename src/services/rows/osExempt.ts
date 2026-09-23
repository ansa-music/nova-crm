import { updateDoc } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths } from "@/firebase/firestore";
import { supabaseRows } from "@/lib/supabaseRows";
import { usesSupabaseRows } from "@/services/rows/rowsBackend";
import type { WorkspacePage } from "@/types";

/**
 * «Технарь правит свой стол сам», пока заказы ведёт ОС (просьба Nurba
 * 23.09.2026: «выборочно давать редакцию стола»).
 *
 * Правило держит БАЗА: в Supabase — таблица rows_os_exempt (её смотрят
 * триггер правки и политика удаления, пишет только Owner через
 * rows_set_desk_os_exempt), в Firestore — `page.techEditable` (его видит
 * интерфейс и правило строк в режиме Firestore; технарю поле трогать нельзя).
 * Порядок как у общего флага: сначала база, потом интерфейс — иначе человек
 * увидел бы «можно», а база бы отказала.
 */
export async function setDeskTechEditable(workspaceId: string, pageId: string, on: boolean): Promise<void> {
  if (!db) throw new Error("Firebase не настроен");
  if (usesSupabaseRows(workspaceId)) {
    const { error } = await supabaseRows.rpc("rows_set_desk_os_exempt", { p_workspace: workspaceId, p_page: pageId, p_on: on });
    if (error) {
      if (error.code === "PGRST202" || error.code === "42883") {
        throw new Error("В Supabase ещё нет этой функции — накатите SQL («Настройки → Строки таблиц → Скопировать SQL»)");
      }
      throw new Error(`Supabase не сохранил: ${error.message}`);
    }
  }
  await updateDoc(paths.page(workspaceId, pageId), { techEditable: on, updatedAt: Date.now() });
}

/**
 * Сессия Owner сверяет таблицу исключений в Supabase с `page.techEditable`:
 * флаг мог попасть только в Firestore (SQL накатили позже, запись в Supabase
 * упала). Правим Supabase под Firestore — в интерфейсе видно именно его.
 * Возвращает, сколько столов поправлено; null — таблицы ещё нет.
 */
export async function reconcileSupabaseOsExempt(workspaceId: string, pages: readonly WorkspacePage[]): Promise<number | null> {
  const { data, error } = await supabaseRows.from("rows_os_exempt").select("page_id").eq("workspace_id", workspaceId);
  if (error) return null;
  const inDb = new Set((data ?? []).map((r) => String((r as { page_id: string }).page_id)));
  const wanted = new Set(pages.filter((p) => p.techEditable && !p.osDesk).map((p) => p.id));
  let fixed = 0;
  for (const id of wanted) {
    if (inDb.has(id)) continue;
    const { error: e } = await supabaseRows.rpc("rows_set_desk_os_exempt", { p_workspace: workspaceId, p_page: id, p_on: true });
    if (!e) fixed += 1;
  }
  for (const id of inDb) {
    // Стол, которого нет в списке (удалён или список неполный), не трогаем:
    // снимать права по неполному списку нельзя.
    if (wanted.has(id) || !pages.some((p) => p.id === id)) continue;
    const { error: e } = await supabaseRows.rpc("rows_set_desk_os_exempt", { p_workspace: workspaceId, p_page: id, p_on: false });
    if (!e) fixed += 1;
  }
  return fixed;
}
