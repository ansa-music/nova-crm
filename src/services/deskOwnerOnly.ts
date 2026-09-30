import { deleteField, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths } from "@/firebase/firestore";
import { supabaseRows } from "@/lib/supabaseRows";
import { corePagesOnSupabase } from "@/services/pageService";
import { rpcSetDeskOwnerOnly } from "@/services/coreStore";
import { isOsDeskId } from "@/services/osDeskService";
import { usesSupabaseRows } from "@/services/rows/rowsBackend";
import { isSbMissingError } from "@/services/sb/sbCollections";
import type { WorkspacePage } from "@/types";

/**
 * Стол «только для Owner» (просьба Nurba 29.09.2026): «выбранный стол
 * недоступен для просмотра никому, остаётся только для Owner — но стол
 * отображается в рейтингах и при выдаче заказа».
 *
 * Флаг живёт в ДВУХ местах, и держат его обе базы:
 *  - документ стола `ownerOnly: true` (Firestore или core_docs + тень в
 *    Firestore) — его читают правила Firestore (`isOwnerOnlyPage`) и интерфейс;
 *  - таблица `rows_owner_only` в Supabase — её читают RLS строк, вкладок, чата,
 *    личных зон и файлов (SQL 20261041). Пишет её только Owner
 *    (`rows_set_desk_owner_only`), в режиме ядра — той же транзакцией, что и
 *    документ стола в core_docs.
 *
 * Порядок — «закрыто, пока не доказано обратное»: включая, сначала база
 * (строки закрываются сразу), потом документ; выключая — наоборот, база
 * последней. Сбой посередине оставляет стол ЗАКРЫТЫМ хотя бы в базе, а не
 * открытым; ошибка уходит человеку — повторить.
 */

export class OwnerOnlySqlMissingError extends Error {
  constructor() {
    super("Нужен свежий SQL (20261041): «Настройки → Строки таблиц» — или дождитесь деплоя");
    this.name = "OwnerOnlySqlMissingError";
  }
}

function sbFlagNeeded(workspaceId: string): boolean {
  return corePagesOnSupabase(workspaceId) || usesSupabaseRows(workspaceId);
}

async function setSbFlag(workspaceId: string, pageId: string, on: boolean) {
  try {
    await rpcSetDeskOwnerOnly(workspaceId, pageId, on);
  } catch (error) {
    if (isSbMissingError(error)) throw new OwnerOnlySqlMissingError();
    throw error;
  }
}

/**
 * Документ стола в Firestore: в режиме ядра — тень (её читают правила), иначе
 * сам стол. Тени `updatedAt` НЕ двигаем: документ в core_docs получил время
 * базы, и тень «новее» его дочитка переноса (core_import) приняла бы за
 * свежую правку и откатила бы стол к старым столбцам и карте ОС.
 */
async function setFirestoreFlag(workspaceId: string, pageId: string, on: boolean) {
  if (!db) return;
  const flag = on ? true : deleteField();
  const patch = corePagesOnSupabase(workspaceId) ? { ownerOnly: flag } : { ownerOnly: flag, updatedAt: Date.now() };
  await setDoc(paths.page(workspaceId, pageId), patch, { merge: true });
}

export async function setPageOwnerOnly(workspaceId: string, page: WorkspacePage, on: boolean): Promise<void> {
  if (!db) throw new Error("Firebase не настроен");
  if (page.osDesk || isOsDeskId(page.id)) throw new Error("Стол ОС не закрывают «только для Owner» — ОС потерял бы свой стол");
  const sb = sbFlagNeeded(workspaceId);
  const core = corePagesOnSupabase(workspaceId);
  if (on) {
    if (sb) await setSbFlag(workspaceId, page.id, true);
    await setFirestoreFlag(workspaceId, page.id, true);
    return;
  }
  if (core) {
    // Документ стола и флаг в базе снимает одна функция; тень — следом.
    await setSbFlag(workspaceId, page.id, false);
    await setFirestoreFlag(workspaceId, page.id, false);
    return;
  }
  await setFirestoreFlag(workspaceId, page.id, false);
  if (sb) await setSbFlag(workspaceId, page.id, false);
}

/** Столы, закрытые в базе (null — таблицы нет или не прочиталось). */
export async function fetchOwnerOnlyPageIds(workspaceId: string): Promise<Set<string> | null> {
  if (!usesSupabaseRows(workspaceId)) return null;
  const { data, error } = await supabaseRows.from("rows_owner_only").select("page_id").eq("workspace_id", workspaceId);
  if (error) return null;
  return new Set((data as { page_id: string }[] | null)?.map((r) => r.page_id) ?? []);
}

/**
 * Сессия Owner: стол помечен в документе, а в базе флага нет (вкладка на
 * старом коде, SQL вставили позже, сбой посередине) — дописать в базу; в
 * режиме ядра — ещё и в тень Firestore (её читают правила Firestore: архив
 * строк, чат и личные зоны до переезда). Только ПОДНИМАЕТ флаг: снимать его
 * может лишь явное действие Owner — устаревший снимок столов иначе молча
 * открыл бы закрытый стол.
 */
export async function reconcileOwnerOnlyDesks(workspaceId: string, pages: WorkspacePage[]): Promise<number | null> {
  const wanted = pages.filter((p) => p.ownerOnly === true && !p.osDesk && !isOsDeskId(p.id));
  if (wanted.length === 0) return 0;
  let fixed = 0;
  const have = await fetchOwnerOnlyPageIds(workspaceId);
  if (have) {
    for (const page of wanted) {
      if (have.has(page.id)) continue;
      try {
        await setSbFlag(workspaceId, page.id, true);
        fixed += 1;
      } catch (error) {
        console.warn(`[owner-only] стол ${page.id} не закрыт в базе`, error);
      }
    }
  }
  if (db && corePagesOnSupabase(workspaceId)) {
    for (const page of wanted) {
      try {
        const shadow = await getDoc(paths.page(workspaceId, page.id));
        if (shadow.exists() && shadow.data()?.ownerOnly === true) continue;
        await setFirestoreFlag(workspaceId, page.id, true);
        fixed += 1;
      } catch (error) {
        console.warn(`[owner-only] тень стола ${page.id} в Firestore не закрыта`, error);
      }
    }
  }
  return have || corePagesOnSupabase(workspaceId) ? fixed : null;
}
