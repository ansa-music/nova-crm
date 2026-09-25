import { useEffect, useMemo, useState } from "react";
import { ClipboardPaste } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ScheduleRow } from "@/components/schedule/scheduleShared";
import { cn } from "@/utils/cn";
import {
  matchPastedNames,
  parseWeekTable,
  pastedNameKey,
  pastedWeekChanges,
  resolvePastedTargets,
  weekCellText,
  type ParsedWeekCell,
} from "@/utils/weekTemplate";
import { formatScheduleHours, WEEK_DOW_SHORT, WEEK_DOWS, type WeekCell } from "@/types";

const SKIP = "";

function cellText(cell: ParsedWeekCell | undefined): string {
  if (!cell || cell.kind === "empty") return "·";
  if (cell.kind === "off") return "вых";
  if (cell.kind === "work") return "раб";
  if (cell.kind === "hours") return formatScheduleHours(cell.hours);
  return "?";
}

export interface WeekPasteResult {
  /** Пусто, если человека ещё нет — его заводят по `newName`. */
  personId: string;
  /**
   * Имя нового человека для своего раздела: в таблице руководства есть те, у
   * кого аккаунта пока нет. Его же кладём как ник ОС — когда ник закрепят за
   * аккаунтом, строка графика переедет на него.
   */
  newName?: string;
  cells: Record<string, ParsedWeekCell>;
}

/** Значение в списке «кому»: завести нового человека в своём разделе. */
const ADD_NEW = "__new__";

/**
 * Память «это имя из таблицы — этот человек», на браузер и workspace.
 * Таблицу вставляют каждую неделю, и одни и те же «Дина Р.» или «Адлет ОС»,
 * которые автоматика не узнаёт, раньше приходилось выбирать руками каждый раз.
 * Это удобство одного руководителя, а не данные команды — поэтому localStorage.
 */
function memoryKey(workspaceId: string): string {
  return `nova:schedule-paste-names:${workspaceId}`;
}

function readMemory(workspaceId: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(memoryKey(workspaceId));
    const value = raw ? (JSON.parse(raw) as unknown) : null;
    return value && typeof value === "object" ? (value as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeMemory(workspaceId: string, memory: Record<string, string>) {
  try {
    localStorage.setItem(memoryKey(workspaceId), JSON.stringify(memory));
  } catch {
    // Нет хранилища (приватное окно) — просто не запомним.
  }
}

/**
 * Вставка недели из Google Sheets / Excel. Таблицу у руководства уже ведут
 * там — перебивать 40 человек по 7 клеток руками незачем.
 *
 * Имена сопоставляются сами, но только однозначно (`matchPastedNames`);
 * спорное человек выбирает в списке. Нераспознанная клетка («отпуск»,
 * «до 15») НЕ пишется — остаётся как было и подсвечена, чтобы её было видно.
 * Сначала видно, ЧТО поменяется (обведено, под клеткой — как было), и только
 * потом «Сохранить неделю» — запись сразу, вернуть можно Ctrl+Z.
 */
export function WeekPasteDialog({
  workspaceId,
  rows,
  currentOf,
  initialText,
  canAddPeople = false,
  onClose,
  onApply,
}: {
  workspaceId: string;
  rows: ScheduleRow[];
  /** Неделя человека сейчас (с ещё не записанным) — чтобы показать, что именно поменяется. */
  currentOf: (personId: string) => Record<string, WeekCell>;
  initialText?: string;
  /** Можно ли заводить людей, которых в графике ещё нет (свой раздел). */
  canAddPeople?: boolean;
  onClose: () => void;
  onApply: (result: WeekPasteResult[]) => void;
}) {
  const [text, setText] = useState(initialText ?? "");
  const parsed = useMemo(() => parseWeekTable(text), [text]);
  const candidates = useMemo(
    () =>
      rows.map((row) => ({
        id: row.uid,
        names: [row.label, row.member?.name ?? "", row.member?.nickname ?? ""],
      })),
    [rows]
  );
  const [memory] = useState(() => readMemory(workspaceId));
  const autoMatch = useMemo(() => {
    const names = parsed.rows.map((r) => r.name);
    return resolvePastedTargets(names, matchPastedNames(names, candidates), memory, new Set(rows.map((r) => r.uid)));
  }, [parsed, candidates, memory, rows]);
  const [picked, setPicked] = useState<Record<number, string>>({});
  const [onlyChanges, setOnlyChanges] = useState(false);
  // Новая вставка — новые строки: ручной выбор от прошлой не применим.
  useEffect(() => setPicked({}), [text]);

  const target = (index: number) => picked[index] ?? autoMatch[index] ?? SKIP;
  const chosen = parsed.rows.map((_, i) => target(i));
  const duplicates = new Set(chosen.filter((id, i) => id && id !== ADD_NEW && chosen.indexOf(id) !== i));
  const matched = chosen.filter(Boolean).length;
  const unknownCells = parsed.rows.reduce(
    (sum, row, i) => sum + (chosen[i] ? Object.values(row.cells).filter((c) => c.kind === "unknown").length : 0),
    0
  );
  // Что вставка ПОМЕНЯЕТ, а не что в ней написано: сверять глазами таблицу
  // из Sheets с неделей на экране — ровно то, на что жаловались.
  const changes = parsed.rows.map((row, i) => {
    const id = chosen[i];
    if (!id || id === ADD_NEW || duplicates.has(id)) return null;
    return pastedWeekChanges(currentOf(id), row.cells);
  });
  const changedPeople = changes.filter((c) => c && Object.keys(c).length > 0).length;
  const changedDays = changes.reduce((sum, c) => sum + (c ? Object.keys(c).length : 0), 0);
  const newPeople = chosen.filter((id) => id === ADD_NEW).length;

  function remember() {
    const next = { ...memory };
    let dirty = false;
    parsed.rows.forEach((row, i) => {
      if (!(i in picked)) return;
      const key = pastedNameKey(row.name);
      if (!key) return;
      const id = picked[i];
      if (id && id !== ADD_NEW) {
        if (next[key] !== id) {
          next[key] = id;
          dirty = true;
        }
      } else if (next[key]) {
        // Выбрали «пропустить» или «завести» — старую привязку забываем.
        delete next[key];
        dirty = true;
      }
    });
    if (dirty) writeMemory(workspaceId, next);
  }

  function apply() {
    remember();
    const out: WeekPasteResult[] = [];
    parsed.rows.forEach((row, i) => {
      const id = chosen[i];
      if (id === ADD_NEW) {
        out.push({ personId: "", newName: row.name, cells: row.cells });
        return;
      }
      if (id && !duplicates.has(id)) out.push({ personId: id, cells: row.cells });
    });
    onApply(out);
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardPaste className="h-4 w-4 shrink-0 text-primary" />
            Вставить неделю из таблицы
          </DialogTitle>
          <DialogDescription>
            Скопируйте в Google Sheets блок с именами и днями недели (можно вместе со строкой «Понедельник…») и вставьте
            сюда. Понимаем «работа», «вых», «с 12:45», «12:30 до 15:00», «с 11 до 18», «10-12,15-19». Обведено то, что
            поменяется (под клеткой — как было); кого выберете руками, запомним к следующей вставке.
          </DialogDescription>
        </DialogHeader>

        {parsed.rows.length === 0 ? (
          <>
            <textarea
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Ctrl+V — вставьте таблицу сюда"
              className="min-h-40 w-full rounded-lg border border-border bg-background p-3 font-mono text-[12px] outline-none focus:border-primary/60"
            />
            {text.trim() && (
              <p className="text-[12px] text-warning">
                Не нашли ни одной строки «имя + дни недели». Скопируйте блок целиком: колонку с именами и семь колонок
                Пн…Вс (строку с названиями дней — тоже, если она есть).
              </p>
            )}
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
              <span>
                Строк в таблице: <span className="font-medium tabular-nums">{parsed.rows.length}</span>
              </span>
              <span className={matched === parsed.rows.length ? "text-success" : "text-warning"}>
                узнали людей: <span className="font-medium tabular-nums">{matched}</span>
              </span>
              <span className="font-medium text-primary">
                поменяется: <span className="tabular-nums">{changedDays}</span> дн. у{" "}
                <span className="tabular-nums">{changedPeople}</span> чел.
                {newPeople > 0 && <span className="text-foreground"> + новых: {newPeople}</span>}
              </span>
              {unknownCells > 0 && (
                <span className="text-warning">
                  непонятных клеток: <span className="font-medium tabular-nums">{unknownCells}</span> — останутся как были
                </span>
              )}
              {!parsed.headerFound && (
                <span className="text-muted-foreground">без строки дней — читаем колонки как Пн…Вс</span>
              )}
              <label className="ml-auto inline-flex min-h-11 cursor-pointer items-center gap-1.5 text-muted-foreground sm:min-h-0">
                <input type="checkbox" checked={onlyChanges} onChange={(e) => setOnlyChanges(e.target.checked)} />
                только изменения
              </label>
              <button
                type="button"
                onClick={() => setText("")}
                className="min-h-11 text-muted-foreground underline underline-offset-2 sm:min-h-0"
              >
                Вставить другую
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border/70">
              <table className="w-full min-w-[40rem] border-separate border-spacing-0 text-[11px]">
                <thead className="sticky top-0 z-10 bg-card">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">В таблице</th>
                    <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">Кому</th>
                    {WEEK_DOWS.map((dow) => (
                      <th key={dow} className="px-0.5 py-1.5 text-center font-medium text-muted-foreground">
                        {WEEK_DOW_SHORT[dow]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {parsed.rows.map((row, i) => {
                    const id = chosen[i];
                    const dup = Boolean(id) && duplicates.has(id);
                    const rowChanges = changes[i];
                    const changedHere = rowChanges ? Object.keys(rowChanges).length : 0;
                    // «Только изменения» прячет лишь строки, которые точно ничего не
                    // меняют; неузнанные и спорные остаются — их надо решить.
                    if (onlyChanges && id && id !== ADD_NEW && !dup && changedHere === 0) return null;
                    return (
                      <tr key={i} className={cn(!id && "opacity-50")}>
                        <td className="max-w-[8rem] truncate px-2 py-1 font-medium" title={row.name}>
                          {row.name}
                        </td>
                        <td className="px-2 py-1">
                          <select
                            value={id}
                            onChange={(e) => setPicked((prev) => ({ ...prev, [i]: e.target.value }))}
                            className={cn(
                              "h-8 w-40 rounded-md border bg-background px-1.5 text-[11px]",
                              dup ? "border-destructive text-destructive" : id ? "border-border" : "border-warning/60"
                            )}
                            title={dup ? "Этот человек выбран у двух строк — ни одна не запишется" : undefined}
                          >
                            <option value={SKIP}>— пропустить —</option>
                            {canAddPeople && <option value={ADD_NEW}>+ завести «{row.name}»</option>}
                            {rows.map((r) => (
                              <option key={r.uid} value={r.uid}>
                                {r.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        {WEEK_DOWS.map((dow) => {
                          const cell = row.cells[String(dow)];
                          const change = rowChanges?.[String(dow)];
                          // У узнанного человека клетка, которая ничего не меняет, приглушена:
                          // глаз цепляется только за то, что станет другим.
                          const same = Boolean(rowChanges) && !change && cell?.kind !== "unknown";
                          return (
                            <td key={dow} className="px-0.5 py-1 text-center">
                              <span
                                title={
                                  cell?.kind === "unknown"
                                    ? `Не поняли: «${cell.text}» — клетка останется как была`
                                    : change
                                      ? `Было: ${weekCellText(change.before)} → станет: ${weekCellText(change.after)}`
                                      : rowChanges
                                        ? "Так и есть — не меняется"
                                        : undefined
                                }
                                className={cn(
                                  "inline-block w-full min-w-[3rem] truncate rounded-sm border px-0.5 py-0.5",
                                  same && "opacity-35",
                                  change && "ring-1 ring-primary ring-offset-1 ring-offset-card",
                                  cell?.kind === "off"
                                    ? "border-destructive/45 bg-destructive/15 text-destructive"
                                    : cell?.kind === "hours"
                                      ? "border-primary/50 bg-primary/15 text-primary"
                                      : cell?.kind === "unknown"
                                        ? "border-warning/60 bg-warning/15 text-warning"
                                        : "border-border/50 text-muted-foreground/70"
                                )}
                              >
                                {cellText(cell)}
                              </span>
                              {change && (
                                <span className="mt-0.5 block truncate text-[9px] leading-3 text-muted-foreground line-through">
                                  {weekCellText(change.before)}
                                </span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button className="min-h-11 sm:min-h-0" disabled={matched === 0} onClick={apply}>
            Сохранить неделю{changedDays > 0 ? ` · ${changedDays} дн.` : ""}
          </Button>
          <p className="text-[11px] text-muted-foreground">Сразу разложится в «Месяц» с сегодняшнего дня. Вернуть — Ctrl+Z.</p>
          <Button variant="ghost" className="ml-auto min-h-11 sm:min-h-0" onClick={onClose}>
            Отмена
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
