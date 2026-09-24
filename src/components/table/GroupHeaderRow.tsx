import { memo } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/utils/cn";

interface GroupHeaderRowProps {
  label: string;
  count: number;
  colSpan: number;
  collapsed: boolean;
  /** Получает `label` — колбэк один на все группы, и memo заголовка работает. */
  onToggle: (label: string) => void;
  color?: string;
  /** Pre-formatted currency total for the group, if the table has a money column. */
  sumText?: string | null;
  /** Pre-formatted «Готово» share of that total. */
  doneText?: string | null;
  /**
   * Виртуализация стола: заголовок — такой же элемент списка, как строка, но
   * его высота зависит от ширины экрана (44 на телефоне, ~30 на ПК), поэтому
   * виртуализатор меряет его сам (measureElement + data-index).
   */
  measureRef?: (el: HTMLTableRowElement | null) => void;
  dataIndex?: number;
}

/**
 * Строка группы по макету «C — плотный по статусам»: 30px, «▾ Статус · N»,
 * точечный лидер до правого края и сумма моно цветом статуса. Пилюли
 * «✓ Готово» и счётчика нет — в шапке группы это шум; доля «Готово» внутри
 * группы всё равно почти всегда равна либо 0, либо всей сумме (группировка
 * идёт по статусу). `doneText` в пропсах оставлен: DataTable его считает и
 * передаёт, а рисовать его тут больше не нужно.
 *
 * `--group-color` кладётся на <tr>, а не на кнопку: подложку красит td
 * (`.table-group-cell` в index.css), и переменная на дочерней кнопке до него
 * не доходила. Формат — HSL-триплет «h s% l%», как у statusOptions.color.
 */
function GroupHeaderRowInner({
  label,
  count,
  colSpan,
  collapsed,
  onToggle,
  color,
  sumText,
  measureRef,
  dataIndex,
}: GroupHeaderRowProps) {
  const tone = color ? { color: `hsl(${color})` } : undefined;
  return (
    <tr
      ref={measureRef}
      data-index={dataIndex}
      className={cn("table-group-row", color && "table-group-row-colored")}
      style={color ? ({ "--group-color": color } as React.CSSProperties) : undefined}
    >
      <td colSpan={colSpan + 1} className="table-group-cell border-b border-border p-0">
        <button
          type="button"
          onClick={() => onToggle(label)}
          className="table-group-toggle flex min-h-11 items-center gap-2 px-3 py-1 text-left text-[12.5px] sm:min-h-0"
          aria-expanded={!collapsed}
        >
          {collapsed ? (
            <ChevronRight className="h-3.5 w-3.5 shrink-0" style={tone} />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 shrink-0" style={tone} />
          )}
          <span className={cn("min-w-0 truncate font-medium", !label && "italic text-muted-foreground")} style={tone}>
            {label || "Без значения"}
          </span>
          <span className="shrink-0 font-normal tabular-nums text-muted-foreground">· {count}</span>
          <span className="mx-2 min-w-4 flex-1 self-center border-b border-dotted border-muted-foreground/30" aria-hidden />
          {sumText && (
            <span className="shrink-0 font-mono text-[12.5px] tabular-nums" style={tone} title="Сумма по группе">
              {sumText}
            </span>
          )}
        </button>
      </td>
    </tr>
  );
}

// Правка ячейки меняет строки, а не заголовки: без memo каждая правка
// перерисовывала и все заголовки групп.
export const GroupHeaderRow = memo(GroupHeaderRowInner);
