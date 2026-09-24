import { useEffect, useSyncExternalStore } from "react";
import { updateDoc } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths } from "@/firebase/firestore";
import { supabaseRows } from "@/lib/supabaseRows";
import { usesSupabaseRows } from "@/services/rows/rowsBackend";
import { setSupabaseOsManaged } from "@/services/rows/rowsMigrationService";
import type { Workspace } from "@/types";

/**
 * Кто заполняет столы технарей (вкладка Owner «Правка столов», 24.09.2026).
 *
 * - `os`    — заказы ведёт ОС: технарь правит только ссылку и примечание,
 *             статус просит («Успешка»);
 * - `tech`  — технари заполняют сами: весь свой стол, включая строки-заказы,
 *             которые выдал ОС (статус оттуда проход стола ОС подтягивает к ОС);
 * - `mixed` — как было до 24.09: свои строки технарь правит, строки ОС — нет.
 *
 * Выборочно (стол-исключение, `page.techEditable`) технарь заполняет сам в
 * ЛЮБОМ режиме — см. `setDeskTechEditable`.
 *
 * Правило держит база: `rows_workspaces.os_managed/tech_fills_all` и триггеры
 * `desk_rows_guard`/`desk_rows_os_managed` (20261001_tech_fill.sql). Firestore
 * (`osManagedDesks`, `techFillsAll`) — то, что видит интерфейс, и страховка
 * правил на случай отката строк в Firestore.
 */
export type DeskMode = "os" | "tech" | "mixed";

export function deskModeOf(workspace: Pick<Workspace, "osManagedDesks" | "techFillsAll"> | null | undefined): DeskMode {
  if (workspace?.techFillsAll) return "tech";
  if (workspace?.osManagedDesks) return "os";
  return "mixed";
}

function isMissingFunction(error: { code?: string; message?: string } | null | undefined): boolean {
  return error?.code === "PGRST202" || error?.code === "42883" || /rows_set_desk_mode|rows_desk_mode/i.test(error?.message ?? "");
}

/**
 * Сначала база — правило держит она; потом интерфейс (иначе человек увидел
 * бы «можно», а база бы отказала). Нет новой функции в Supabase (SQL
 * 20261001 не вставлен): `os`/`mixed` ставятся старым `rows_set_os_managed`,
 * а `tech` честно отказывает — без SQL строки ОС технарю не открыть.
 */
export async function setDeskMode(workspaceId: string, mode: DeskMode): Promise<void> {
  if (!db) throw new Error("Firebase не настроен");
  if (usesSupabaseRows(workspaceId)) {
    const { error } = await supabaseRows.rpc("rows_set_desk_mode", { p_workspace: workspaceId, p_mode: mode });
    if (error) {
      if (!isMissingFunction(error)) throw new Error(`Supabase не переключил режим: ${error.message}`);
      if (mode === "tech") {
        throw new Error(
          "В Supabase ещё нет обновления для этого режима — вставьте SQL (плашка сверху или «Настройки → Строки таблиц → Скопировать SQL») и повторите"
        );
      }
      await setSupabaseOsManaged(workspaceId, mode === "os");
    }
  }
  await updateDoc(paths.workspace(workspaceId), {
    osManagedDesks: mode === "os",
    techFillsAll: mode === "tech",
  });
}

/**
 * Сессия Owner сверяет режим в Supabase с Firestore: режим мог попасть только
 * в Firestore (SQL вставили позже, запись в Supabase упала). Возвращает, был
 * ли режим поправлен; `null` — в базе ещё нет функций (старый SQL).
 */
export async function reconcileSupabaseDeskMode(workspaceId: string, wanted: DeskMode): Promise<boolean | null> {
  const { data, error } = await supabaseRows.rpc("rows_desk_mode", { p_workspace: workspaceId });
  if (error) return isMissingFunction(error) ? null : false;
  if (data === wanted || data === null || data === undefined) return false;
  const { error: setError } = await supabaseRows.rpc("rows_set_desk_mode", { p_workspace: workspaceId, p_mode: wanted });
  return !setError;
}

// ---------------------------------------------------------------------
// Знает ли база режим «заполняет сам» для строк ОС (SQL 20261001 вставлен).
// Пока нет, `desk_rows_guard` в Supabase держит строки-заказы ОС запертыми,
// и интерфейс не должен обещать технарю правку, которую база отклонит:
// `useDeskModeSupported` отдаёт false, и стол показывает прежний замок.
// Память — в localStorage на 10 минут (как «таблицы нет» у коллекций).
// ---------------------------------------------------------------------
const SUPPORT_KEY = "nova:desk-mode-sql";
const SUPPORT_RECHECK_MS = 10 * 60_000;
const supportListeners = new Set<() => void>();
let supportMemo: { ok: boolean; at: number } | null = null;
let supportProbe: Promise<boolean> | null = null;

function readSupport(): { ok: boolean; at: number } | null {
  if (supportMemo) return supportMemo;
  try {
    const [state, at] = (window.localStorage.getItem(SUPPORT_KEY) ?? "").split("@");
    if ((state === "yes" || state === "no") && Number(at) > 0) supportMemo = { ok: state === "yes", at: Number(at) };
  } catch {
    /* без localStorage — память на вкладку */
  }
  return supportMemo;
}

function writeSupport(ok: boolean) {
  const prev = readSupport();
  supportMemo = { ok, at: Date.now() };
  try {
    window.localStorage.setItem(SUPPORT_KEY, `${ok ? "yes" : "no"}@${supportMemo.at}`);
  } catch {
    /* см. readSupport */
  }
  if (prev?.ok !== ok) supportListeners.forEach((fn) => fn());
}

/** Спросить базу, есть ли `rows_desk_mode`. Сеть и прочие ошибки память не меняют. */
export function probeDeskModeSupport(workspaceId: string): Promise<boolean> {
  if (supportProbe) return supportProbe;
  supportProbe = (async () => {
    try {
      const { error } = await supabaseRows.rpc("rows_desk_mode", { p_workspace: workspaceId });
      if (!error) writeSupport(true);
      else if (isMissingFunction(error)) writeSupport(false);
    } catch {
      /* сеть — ответа нет */
    }
    return readSupport()?.ok ?? false;
  })().finally(() => {
    supportProbe = null;
  });
  return supportProbe;
}

function subscribeSupport(fn: () => void) {
  supportListeners.add(fn);
  return () => {
    supportListeners.delete(fn);
  };
}

function supportSnapshot(): string {
  const s = readSupport();
  return s ? `${s.ok}` : "unknown";
}

/**
 * Поддерживает ли хранилище строк «заполняет сам» для заказов ОС. Firestore —
 * да (правила уже в деплое); Supabase — по пробе `rows_desk_mode`. `null` —
 * ещё не знаем (считать как «нет»: лучше лишний замок, чем отказ после ввода).
 */
export function useDeskModeSupported(workspaceId: string | null | undefined): boolean | null {
  const snapshot = useSyncExternalStore(subscribeSupport, supportSnapshot, supportSnapshot);
  const supabase = workspaceId ? usesSupabaseRows(workspaceId) : false;
  useEffect(() => {
    if (!workspaceId || !supabase) return;
    const s = readSupport();
    if (!s || Date.now() - s.at >= SUPPORT_RECHECK_MS) void probeDeskModeSupport(workspaceId);
  }, [workspaceId, supabase]);
  if (!workspaceId) return null;
  if (!supabase) return true;
  return snapshot === "unknown" ? null : snapshot === "true";
}
