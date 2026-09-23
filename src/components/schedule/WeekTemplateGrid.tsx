import { MemberAvatar } from "@/components/common/MemberAvatar";
import { initialsName, SCHEDULE_STATE_STYLE, type ScheduleRow } from "@/components/schedule/ScheduleGrid";
import { cn } from "@/utils/cn";
import { formatScheduleHours, WEEK_DOW_SHORT, WEEK_DOWS, type WeekCell } from "@/types";

/**
 * Неделя графика — ровно та таблица, которую руководство и так вело в Google
 * Sheets: люди по строкам, Пн…Вс по колонкам, внизу «на смене» по каждому дню.
 * Правится кистью: выбрал «Выходной» (или «Смена 12:30–15:00») — и кликаешь
 * по клеткам; клик по заголовку дня красит весь столбец раздела.
 */
export function WeekTemplateGrid({
  rows,
  cellsOf,
  isPending,
  meUid,
  todayDow,
  editing,
  onCellClick,
  onColumnClick,
  onNameClick,
}: {
  rows: ScheduleRow[];
  /** Неделя человека: черновик, если он есть, иначе сохранённая. */
  cellsOf: (row: ScheduleRow) => Record<string, WeekCell>;
  /** Клетка изменена в черновике и ещё не сохранена. */
  isPending: (row: ScheduleRow, dow: number) => boolean;
  meUid?: string;
  /** День недели «сегодня» по Алматы — подсвечивается колонка. */
  todayDow: number;
  editing: boolean;
  onCellClick?: (row: ScheduleRow, dow: number) => void;
  onColumnClick?: (dow: number) => void;
  /** Клик по имени — неделя человека одним окном (только у тех, кто правит). */
  onNameClick?: (row: ScheduleRow) => void;
}) {
  if (rows.length === 0) return null;
  const onShift = (dow: number) => rows.filter((row) => !cellsOf(row)[String(dow)]?.off).length;

  return (
    // На компьютере таблица помещается целиком, и строка дней прилипает под
    // панелью страницы (--schedule-bar-h): без неё, пролистав вниз, уже не
    // видно, какой столбец — вторник. На телефоне нужна прокрутка вбок, а она
    // прилипание по вертикали отключает — там дни видны в каждой клетке-подсказке.
    <div className="overflow-x-auto lg:overflow-visible">
      <table className="w-full min-w-[34rem] border-separate border-spacing-0 text-[12px]">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 w-28 min-w-[7rem] bg-card px-2 py-1 text-left font-medium text-muted-foreground sm:w-44 sm:min-w-[11rem] lg:top-[var(--schedule-bar-h,0px)] lg:z-[15]">
              Кто
            </th>
            {WEEK_DOWS.map((dow) => {
              const label = WEEK_DOW_SHORT[dow];
              const weekend = dow === 0 || dow === 6;
              const today = dow === todayDow;
              return (
                <th
                  key={dow}
                  className="min-w-[4.25rem] bg-card px-0.5 pb-1 text-center font-medium lg:sticky lg:top-[var(--schedule-bar-h,0px)] lg:z-[14]"
                >
                  {editing && onColumnClick ? (
                    <button
                      type="button"
                      onClick={() => onColumnClick(dow)}
                      title={`Кисть на весь столбец «${label}» в этом разделе`}
                      className={cn(
                        "min-h-9 w-full rounded-md border border-dashed border-primary/40 text-[12px] transition-colors hover:bg-primary/10",
                        today ? "text-primary" : weekend ? "text-foreground/80" : "text-muted-foreground"
                      )}
                    >
                      {label}
                    </button>
                  ) : (
                    <span
                      className={cn(
                        "mx-auto inline-block rounded-full px-2 py-0.5",
                        today ? "bg-primary font-semibold text-primary-foreground" : weekend ? "text-foreground/80" : "text-muted-foreground"
                      )}
                    >
                      {label}
                    </span>
                  )}
                </th>
              );
            })}
            <th
              className="bg-card px-2 pb-1 text-center font-medium text-muted-foreground/60 lg:sticky lg:top-[var(--schedule-bar-h,0px)] lg:z-[14]"
              title="Выходных в неделю"
            >
              В
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const cells = cellsOf(row);
            const isMe = Boolean(meUid) && row.uid === meUid;
            const offCount = WEEK_DOWS.filter((dow) => cells[String(dow)]?.off).length;
            return (
              <tr key={row.uid} className={cn(isMe && "bg-primary/[0.06]")}>
                <td
                  className={cn(
                    "sticky left-0 z-10 w-28 min-w-[7rem] py-0.5 pr-2 sm:w-44 sm:min-w-[11rem] sm:pr-3",
                    isMe ? "bg-[hsl(var(--card))] shadow-[inset_0_0_0_9999px_hsl(var(--primary)/0.06)]" : "bg-card"
                  )}
                >
                  <NameCell onClick={onNameClick ? () => onNameClick(row) : undefined} label={row.label}>
                    <MemberAvatar
                      id={row.member?.uid ?? row.uid}
                      name={row.member?.name ?? initialsName(row.label)}
                      nickname={row.member?.nickname}
                      photoURL={row.member?.photoURL}
                      className="h-6 w-6 shrink-0"
                    />
                    <span
                      className={cn(
                        "min-w-0 max-w-[4.5rem] flex-1 truncate text-[12px] sm:max-w-[8.5rem]",
                        isMe && "font-semibold text-primary"
                      )}
                      title={row.label}
                    >
                      {row.label}
                    </span>
                    {isMe && (
                      <span className="shrink-0 rounded-full bg-primary/15 px-1.5 text-[9px] leading-4 text-primary">вы</span>
                    )}
                  </NameCell>
                </td>
                {WEEK_DOWS.map((dow) => {
                  const cell = cells[String(dow)] ?? { off: false, hours: null };
                  const pending = isPending(row, dow);
                  const text = cell.off ? "вых" : cell.hours ? formatScheduleHours(cell.hours) : "работа";
                  const weekend = dow === 0 || dow === 6;
                  return (
                    <td key={dow} className={cn("p-0.5 text-center", dow === todayDow && "bg-primary/[0.07]")}>
                      <button
                        type="button"
                        disabled={!editing}
                        onClick={editing ? () => onCellClick?.(row, dow) : undefined}
                        title={`${row.label} · ${WEEK_DOW_SHORT[dow]} — ${cell.off ? "выходной" : cell.hours ? `смена ${formatScheduleHours(cell.hours)}` : "рабочий день"}`}
                        className={cn(
                          "h-9 w-full min-w-[4rem] truncate rounded-md border px-1 text-[11px] transition-colors",
                          cell.off
                            ? cn(SCHEDULE_STATE_STYLE.off, "font-semibold")
                            : cell.hours
                              ? "border-primary/50 bg-primary/15 font-medium text-primary"
                              : cn("border-border/50 text-muted-foreground/60", weekend && "bg-foreground/[0.05]"),
                          pending && "ring-1 ring-primary ring-offset-1 ring-offset-card",
                          editing ? "cursor-pointer hover:brightness-125" : "cursor-default"
                        )}
                      >
                        {text}
                      </button>
                    </td>
                  );
                })}
                <td className="px-2 text-center font-mono text-[11px] tabular-nums text-muted-foreground">{offCount || ""}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td className="sticky left-0 z-10 bg-card px-2 pt-1.5 text-[11px] text-muted-foreground">На смене</td>
            {WEEK_DOWS.map((dow) => (
              <td
                key={dow}
                className={cn(
                  "pt-1.5 text-center font-mono text-[12px] font-medium tabular-nums",
                  dow === todayDow ? "text-primary" : "text-foreground/80"
                )}
              >
                {onShift(dow)}
              </td>
            ))}
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/**
 * Имя в строке недели. У того, кто правит график, это кнопка «неделя
 * человека»: ставить одному человеку выходные и смены через кисть значило
 * искать его строку и попадать в клетки.
 */
function NameCell({ onClick, label, children }: { onClick?: () => void; label: string; children: React.ReactNode }) {
  if (!onClick) return <span className="flex min-w-0 items-center gap-1.5">{children}</span>;
  return (
    <button
      type="button"
      onClick={onClick}
      title={`Неделя: ${label} — все дни в одном окне`}
      className="flex min-h-9 w-full min-w-0 items-center gap-1.5 rounded-md text-left transition-colors hover:bg-primary/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
    >
      {children}
    </button>
  );
}
