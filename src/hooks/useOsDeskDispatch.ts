import { useEffect, useRef, useState } from "react";
import { updateDoc } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths } from "@/firebase/firestore";
import { toast } from "@/components/ui/sonner";
import { useWorkspace } from "@/hooks/useWorkspace";
import { OS_DESK_COLUMNS } from "@/services/osDeskService";
import { findTechTarget, OS_MIRROR_COLUMNS, pushOrderToTech, techTargetProblem, techUidByNick } from "@/services/rows/osOrderMirror";
import { sbDeleteRow } from "@/services/rows/supabaseRowStore";
import { findDuplicateMirrors, mirrorAddressOf, planOsDispatch } from "@/utils/osDispatchPlan";
import { sbPatchRow } from "@/services/rows/supabaseRowStore";
import { usesSupabaseRows } from "@/services/rows/rowsBackend";
import {
  approvalStatusValue,
  DEFAULT_STATUS_OPTIONS,
  ensureApprovalStatus,
  ensureDoneStatus,
  findInProgressStatusOption,
  isApprovalStatusValue,
} from "@/utils/columnOptions";
import { logOsDispatch } from "@/services/osDispatchLogService";
import { isExchangeHandoffRow } from "@/services/rows/osExchange";
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
 *
 * УТВЕРЖДЕНИЕ (просьба Nurba 23.09.2026): новый заказ получает статус
 * «Утверждение» и технарю НЕ уходит, даже если технарь уже выбран. Когда ОС
 * ставит «В работе» (любой статус, кроме утверждения), стол спрашивает, как
 * отдать заказ: «Общий» — на биржу «Заказы», всем технарям, или
 * «Выборочно» — выбранному технарю (`choiceRow`, диалог рисует стол).
 * Выдачу выбранному технарю (и смену, и снятие) проход пишет в журнал
 * «Выдачи ОС» — его смотрят Тимлид и Owner.
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

const OS_COLUMNS = OS_MIRROR_COLUMNS;

function cellText(row: PageRow, key: string | undefined): string {
  if (!key) return "";
  const value = row.cells[key];
  return value === null || value === undefined ? "" : String(value).trim();
}

export function useOsDeskDispatch(input: OsDeskDispatchInput) {
  const { pages, members, activeWorkspace } = useWorkspace();
  const latest = useRef(input);
  latest.current = input;
  const statusOptions = ensureApprovalStatus(ensureDoneStatus(activeWorkspace?.statusOptions ?? DEFAULT_STATUS_OPTIONS));
  const ctx = useRef({ pages, members, statusOptions });
  ctx.current = { pages, members, statusOptions };
  /**
   * Какой статус был у строки в прошлый проход — по переходу «Утверждение →
   * В работе» стол спрашивает, как отдать заказ. Первый проход только
   * запоминает: открыть стол — не повод для вопроса.
   */
  const seenStatus = useRef(new Map<string, string>());
  const seenScope = useRef("");
  /** Строка, по которой стол спрашивает «общий или выборочно». */
  const [choiceRowId, setChoiceRowId] = useState<string | null>(null);
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
      const scope = `${cur.workspaceId}|${cur.pageId}|${cur.subPageId ?? ""}`;
      const firstLook = seenScope.current !== scope;
      if (firstLook) {
        seenScope.current = scope;
        seenStatus.current = new Map();
      }
      const nameOf = (uid: string | null | undefined, fallback = "") =>
        (uid ? personLabel(allMembers.find((m) => m.uid === uid)) : "") || fallback;
      const osName = nameOf(cur.osUid, "ОС");

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
        const statusNow = statusColumn ? cellText(row, statusColumn.key) : "";
        const onApproval = isApprovalStatusValue(statusNow, statusOptions);
        const prevStatus = seenStatus.current.get(row.id);
        seenStatus.current.set(row.id, statusNow);

        // Новый заказ (имя есть, статуса нет, никому не отдан) — «Утверждение».
        if (statusColumn && !statusNow && client && !at && !techNick && !row.orderId) {
          busy.current.add(row.id);
          try {
            await sbPatchRow(cur.workspaceId, cur.pageId, cur.subPageId, row.id, {
              cells: { [statusColumn.key]: approvalStatusValue(statusOptions) },
            });
            changed = true;
          } catch {
            // Не вышло — попробуем в следующий проход; выдачу это не держит.
          } finally {
            busy.current.delete(row.id);
          }
          continue;
        }

        // «Утверждение → В работе» у заказа, который ещё никому не отдан, —
        // спросить, как отдать. На первом взгляде на стол не спрашиваем.
        if (
          !firstLook &&
          prevStatus !== undefined &&
          isApprovalStatusValue(prevStatus, statusOptions) &&
          !onApproval &&
          !techNick &&
          !at &&
          !row.orderId &&
          client
        ) {
          setChoiceRowId(row.id);
        }

        // На утверждении заказ технарю не уходит, даже если технарь выбран.
        if (!at && onApproval) {
          if (techNick && client && !told.current.has(`${row.id}:approval`)) {
            told.current.add(`${row.id}:approval`);
            toast.info(`${client}: заказ на утверждении`, {
              description: "Технарю он уйдёт, когда вы поставите «В работе».",
            });
          }
          continue;
        }
        if (!techNick && !at) continue;

        // Ник стёрли — заказ забирают у технаря. Стол ему для этого не нужен.
        if (!techNick && at) {
          busy.current.add(row.id);
          try {
            await sbDeleteRow(cur.workspaceId, at.pageId, at.tabId, at.rowId);
            changed = true;
            toast.success("Заказ убран у технаря", { description: client || undefined });
            const prevUid = allPages.find((p) => p.id === at.pageId)?.responsibleUserId ?? null;
            void logOsDispatch(cur.workspaceId, {
              kind: "unassign",
              osUid: cur.osUid,
              osName,
              techUid: null,
              techName: "",
              prevTechName: nameOf(prevUid, "технарь"),
              client,
              phone: cellText(row, OS_COLUMNS.phone),
              amount: orderAmount(row),
              srcPageId: cur.pageId,
              srcRowId: row.id,
            }).catch(() => undefined);
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
            const pushed = await pushOrderToTech({
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
              const viaExchange = isExchangeHandoffRow(row.id);
              // Выдача выбранному технарю — в журнал руководству. Заказ,
              // пришедший с биржи, туда не пишем: его видно на «Заказах».
              if (!viaExchange) {
                const prevUid = plan.removeAt
                  ? (allPages.find((p) => p.id === plan.removeAt?.pageId)?.responsibleUserId ?? null)
                  : null;
                void logOsDispatch(cur.workspaceId, {
                  kind: plan.action === "move" ? "move" : "assign",
                  osUid: cur.osUid,
                  osName,
                  techUid,
                  techName: name,
                  prevTechName: prevUid ? nameOf(prevUid, "технарь") : null,
                  client,
                  phone: cellText(row, OS_COLUMNS.phone),
                  amount: orderAmount(row),
                  srcPageId: cur.pageId,
                  srcRowId: row.id,
                }).catch(() => undefined);
              }
              // Заказ висел на бирже, а ОС отдал его сам — закрываем его там,
              // иначе технари продолжали бы откликаться на уже отданный заказ.
              if (row.orderId && !viaExchange && db) {
                const now = Date.now();
                void updateDoc(paths.order(cur.workspaceId, row.orderId), {
                  status: "taken",
                  takenAt: now,
                  takenPageId: target.page.id,
                  takenSubPageId: plan.mirrorTabId ?? target.tabId,
                  takenRowId: pushed.rowId,
                  updatedAt: now,
                }).catch(() => undefined);
              }
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

  const choiceRow = choiceRowId ? (rows.find((r) => r.id === choiceRowId) ?? null) : null;
  return {
    /** Заказ, по которому стол спрашивает «общий или выборочно». */
    choiceRow,
    openChoice: (rowId: string) => setChoiceRowId(rowId),
    closeChoice: () => setChoiceRowId(null),
  };
}

/** Цена + апсейл — как сумма у технаря. */
function orderAmount(row: PageRow): number | null {
  const n = (v: unknown) => {
    const parsed = Number(String(v ?? "").replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const total = n(row.cells[OS_COLUMNS.price]) + n(row.cells[OS_COLUMNS.upsell]);
  return total > 0 ? total : null;
}
