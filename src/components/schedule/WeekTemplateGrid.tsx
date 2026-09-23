import { MemberAvatar } from "@/components/common/MemberAvatar";
import { initialsName, SCHEDULE_STATE_STYLE, type ScheduleRow } from "@/components/schedule/ScheduleGrid";
import { cn } from "@/utils/cn";
import { WEEK_SIZES, type ScheduleDensity } from "@/components/schedule/scheduleDensity";
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
  nameClickHint,
  density = "normal",
  minOnShift = 0,
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
  /** Подсказка на имени: у редактора — неделя человека, у остальных — его месяц. */
  nameClickHint?: string;
  density?: ScheduleDensity;
  /** Норма на смене: меньше — число дня внизу красное. 0 — без нормы. */
  minOnShift?: number;
}) {
  const size = WEEK_SIZES[density];
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
            <th className={cn("sticky left-0 z-10 bg-card px-2 py-1 text-left text-[11px] font-medium text-muted-foreground lg:top-[var(--schedule-bar-h,0px)] lg:z-[15]", size.col)}>
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
                        "min-h-9 w-full rounded-md border border-dashed border-primary/40 transition-colors hover:bg-primary/10",
                        size.text,
                        today ? "text-primary" : weekend ? "text-foreground/80" : "text-muted-foreground"
                      )}
                    >
                      {label}
                    </button>
                  ) : (
                    <span
                      className={cn(
                        "mx-auto inline-block rounded-full px-2 py-0.5",
                        size.text,
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
              <tr key={row.uid} className={cn("group", isMe && "bg-primary/[0.06]")}>
                <td
                  className={cn(
                    "sticky left-0 z-10 py-0.5 pr-2 sm:pr-3",
                    size.col,
                    isMe ? "bg-[hsl(var(--card))] shadow-[inset_0_0_0_9999px_hsl(var(--primary)/0.06)]" : "bg-card",
                    "group-hover:shadow-[inset_0_0_0_9999px_hsl(var(--foreground)/0.05)]"
                  )}
                >
                  <NameCell onClick={onNameClick ? () => onNameClick(row) : undefined} label={row.label} hint={nameClickHint}>
                    <MemberAvatar
                      id={row.member?.uid ?? row.uid}
                      name={row.member?.name ?? initialsName(row.label)}
                      nickname={row.member?.nickname}
                      photoURL={row.member?.photoURL}
                      className={cn("shrink-0", size.avatar)}
                    />
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate",
                        size.name,
                        size.nameMax,
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
                    <td
                      key={dow}
                      className={cn("p-0.5 text-center group-hover:bg-foreground/[0.04]", dow === todayDow && "bg-primary/[0.07]")}
                    >
                      <button
                        type="button"
                        disabled={!editing}
                        onClick={editing ? () => onCellClick?.(row, dow) : undefined}
                        title={`${row.label} · ${WEEK_DOW_SHORT[dow]} — ${cell.off ? "выходной" : cell.hours ? `смена ${formatScheduleHours(cell.hours)}` : "рабочий день"}`}
                        className={cn(
                          "w-full truncate rounded-md border px-1 transition-colors",
                          size.cell,
                          size.text,
                          cell.off
                            ? cn(SCHEDULE_STATE_STYLE.off, "font-semibold")
                            : cell.hours
                              ? "border-primary/50 bg-primary/15 font-medium text-primary"
                              : cn("border-border/50 text-muted-foreground/60", weekend && "bg-foreground/[0.05]"),
                          pending && "ring-2 ring-primary ring-offset-1 ring-offset-card",
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
            <td className="sticky left-0 z-10 bg-card px-2 pt-1.5 text-[11px] text-muted-foreground">
              На смене{minOnShift > 0 && <span className="ml-1 opacity-70">· норма {minOnShift}</span>}
            </td>
            {WEEK_DOWS.map((dow) => {
              const count = onShift(dow);
              const short = minOnShift > 0 && count < minOnShift;
              return (
                <td key={dow} className="pt-1.5 text-center">
                  <span
                    title={short ? `На смене ${count}, норма ${minOnShift}` : undefined}
                    className={cn(
                      "inline-block min-w-[2rem] rounded-sm px-1 font-mono font-medium tabular-nums",
                      size.text,
                      short ? "bg-destructive/15 font-semibold text-destructive" : dow === todayDow ? "text-primary" : "text-foreground/80"
                    )}
                  >
                    {count}
                  </span>
                </td>
              );
            })}
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
function NameCell({
  onClick,
  label,
  hint,
  children,
}: {
  onClick?: () => void;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  if (!onClick) return <span className="flex min-w-0 items-center gap-1.5">{children}</span>;
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${label} — ${hint ?? "все дни в одном окне"}`}
      className="flex min-h-9 w-full min-w-0 items-center gap-1.5 rounded-md text-left transition-colors hover:bg-primary/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
    >
      {children}
    </button>
  );
}
