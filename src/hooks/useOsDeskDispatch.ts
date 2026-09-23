import { useEffect, useRef } from "react";
import { toast } from "@/components/ui/sonner";
import { useWorkspace } from "@/hooks/useWorkspace";
import { OS_DESK_COLUMNS } from "@/services/osDeskService";
import { findTechTarget, pushOrderToTech, techTargetProblem, techUidByNick } from "@/services/rows/osOrderMirror";
import { sbDeleteRow } from "@/services/rows/supabaseRowStore";
import { findDuplicateMirrors, mirrorAddressOf, planOsDispatch } from "@/utils/osDispatchPlan";
import { sbPatchRow } from "@/services/rows/supabaseRowStore";
import { usesSupabaseRows } from "@/services/rows/rowsBackend";
import { DEFAULT_STATUS_OPTIONS, findInProgressStatusOption } from "@/utils/columnOptions";
import { firestoreErrorText } from "@/utils/dbError";
import { personLabel } from "@/utils/peopleDesks";
import type { PageRow } from "@/types";

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
 */
const DEBOUNCE_MS = 700;

export interface OsDeskDispatchInput {
  workspaceId: string | null;
  /** Только на СВОЁМ столе ОС: заказы выдаёт их хозяин. */
  enabled: boolean;
  pageId: string;
  subPageId: string | null;
  rows: PageRow[];
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
  };
  osUid: string;
  osNickValue: string;
}

const OS_COLUMNS = {
  client: "client",
  phone: "phone",
  price: "price",
  upsell: "upsell",
  note: "note",
  link: "link",
} as const;

function cellText(row: PageRow, key: string | undefined): string {
  if (!key) return "";
  const value = row.cells[key];
  return value === null || value === undefined ? "" : String(value).trim();
}

export function useOsDeskDispatch(input: OsDeskDispatchInput) {
  const { pages, members, activeWorkspace } = useWorkspace();
  const latest = useRef(input);
  latest.current = input;
  const ctx = useRef({ pages, members, statusOptions: activeWorkspace?.statusOptions ?? DEFAULT_STATUS_OPTIONS });
  ctx.current = { pages, members, statusOptions: activeWorkspace?.statusOptions ?? DEFAULT_STATUS_OPTIONS };
  /** Строки, по которым прямо сейчас идёт запись. */
  const busy = useRef(new Set<string>());
  /** О чём уже сказали человеку — чтобы не повторять тост на каждый такт. */
  const told = useRef(new Set<string>());

  const { workspaceId, enabled, rows, orders } = input;
  /**
   * Пока список своих заказов не прочитан, проход НЕ работает: иначе каждая
   * строка выглядит невыданной, и заказ уезжает технарю ВТОРОЙ раз — те самые
   * дубли. Вторая страховка — адрес копии на самой строке (mirrorAddressOf).
   */
  const ready = !orders.loading && !orders.error;
  const active = Boolean(enabled && workspaceId && ready && usesSupabaseRows(workspaceId ?? ""));
  // Подпись: правка строки меняет updatedAt, выдача — появление зеркала.
  const signature = active
    ? rows.map((r) => `${r.id}:${r.updatedAt}:${r.syncHash ?? ""}`).join("|") +
      "#" +
      [...orders.bySource.entries()].map(([id, m]) => `${id}:${m.updatedAt}`).join("|")
    : "";

  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => void sweep(), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);

    async function sweep() {
      const cur = latest.current;
      const { pages: allPages, members: allMembers, statusOptions } = ctx.current;
      if (!cur.workspaceId) return;
      const techColumn = OS_DESK_COLUMNS.find((c) => c.type === "technician");
      const statusColumn = OS_DESK_COLUMNS.find((c) => c.type === "status");
      let changed = false;

      // Сначала убираем лишние копии одного заказа: иначе они посчитаются у
      // технаря дважды, а проход ниже будет чинить не ту строку.
      const extra = findDuplicateMirrors({
        rows: cur.rows,
        orders: cur.orders.rows,
        targetPageOf: (srcRowId) => {
          const row = cur.rows.find((r) => r.id === srcRowId);
          const nick = row && techColumn ? cellText(row, techColumn.key) : "";
          const uid = techUidByNick(allMembers, nick);
          return uid ? (findTechTarget(allPages, uid)?.page.id ?? "") : "";
        },
      });
      for (const dup of extra) {
        try {
          await sbDeleteRow(cur.workspaceId, dup.pageId, dup.tabId, dup.rowId);
          changed = true;
        } catch {
          // Не вышло — попробуем в следующий проход.
        }
      }
      if (extra.length) toast.success(`Убрал лишние копии заказов: ${extra.length}`);

      for (const row of cur.rows) {
        if (busy.current.has(row.id)) continue;
        const client = cellText(row, OS_COLUMNS.client);
        const techNick = techColumn ? cellText(row, techColumn.key) : "";
        const mirror = cur.orders.bySource.get(row.id) ?? null;
        const at = mirrorAddressOf(row, mirror);
        if (!techNick && !at) continue;

        // Ник стёрли — заказ забирают у технаря. Стол ему для этого не нужен.
        if (!techNick && at) {
          busy.current.add(row.id);
          try {
            await sbDeleteRow(cur.workspaceId, at.pageId, at.tabId, at.rowId);
            changed = true;
            toast.success("Заказ убран у технаря", { description: client || undefined });
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
        const problem = techTargetProblem(allPages, techUid);
        const target = techUid ? findTechTarget(allPages, techUid) : null;
        if (problem || !target || !techUid) {
          // Молча не выдаём, но один раз объясняем почему: иначе заказ
          // «висит» на столе ОС, и непонятно, дошёл он или нет.
          if (problem && !told.current.has(`${row.id}:${problem}`)) {
            told.current.add(`${row.id}:${problem}`);
            toast.error(`${client || "Заказ"}: ${problem}`);
          }
          continue;
        }

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
        });
        if (plan.action === "none" || plan.action === "wait") continue;

        busy.current.add(row.id);
        try {
          // Сменили технаря: сначала убираем заказ у прежнего, иначе он
          // останется висеть в его столе и посчитается в его загрузке.
          if (plan.action === "move" && plan.removeAt) {
            await sbDeleteRow(cur.workspaceId, plan.removeAt.pageId, plan.removeAt.tabId, plan.removeAt.rowId);
          }
          if (plan.action === "push" || plan.action === "move") {
            await pushOrderToTech({
              workspaceId: cur.workspaceId,
              osUid: cur.osUid,
              osNickValue: cur.osNickValue,
              source: row,
              srcPageId: cur.pageId,
              srcTabId: cur.subPageId,
              osColumns: OS_COLUMNS,
              target,
              techUid,
              status: plan.status,
              dateMs: row.createdAt || 0,
              // При переезде id копии выводим заново: у прежнего технаря
              // строка могла быть его собственной (перенесённый заказ).
              mirrorRowId: plan.action === "move" ? undefined : plan.mirrorRowId,
              // Копия остаётся в своей вкладке: на переломе месяца иначе
              // появилась бы вторая строка того же заказа в новой вкладке.
              mirrorTabId: plan.action === "move" ? undefined : plan.mirrorTabId,
            });
            changed = true;
            if (!plan.hadMirror || plan.action === "move") {
              const name = personLabel(allMembers.find((m) => m.uid === techUid)) || techNick;
              toast.success(`Заказ у технаря: ${name}`, { description: client || undefined });
            }
          } else if (plan.action === "pull" && statusColumn) {
            // Статус поменяли у технаря — показываем его у ОС вместе с новой
            // подписью, иначе следующий проход счёл бы это правкой ОС и
            // отправил бы значение обратно.
            await sbPatchRow(cur.workspaceId, cur.pageId, cur.subPageId, row.id, {
              cells: { [statusColumn.key]: plan.status },
              syncHash: plan.hash,
            });
            changed = true;
          }
        } catch (error) {
          const text = firestoreErrorText(error, "Не удалось отдать заказ технарю");
          if (!told.current.has(`${row.id}:${text}`)) {
            told.current.add(`${row.id}:${text}`);
            toast.error(text);
          }
        } finally {
          busy.current.delete(row.id);
        }
      }
      if (changed) cur.orders.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, signature]);
}
