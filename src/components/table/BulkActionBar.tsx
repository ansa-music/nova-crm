import { CheckCheck, CheckCircle2, Copy, CopyPlus, Download, MoreHorizontal, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusBadge } from "@/components/table/StatusBadge";
import type { PageColumn, StatusOption } from "@/types";

export interface BulkOptionColumn {
  column: PageColumn;
  options: StatusOption[];
}

interface BulkActionBarProps {
  count: number;
  total: number;
  onDelete: () => void;
  onClear: () => void;
  onSelectAll?: () => void;
  statusOptions?: StatusOption[];
  onSetStatus?: (value: string) => void;
  onMarkDone?: () => void;
  /** Every other option column (Ответственный / custom fields) that can be bulk-set. */
  otherOptionColumns?: BulkOptionColumn[];
  onSetOptionValue?: (colKey: string, value: string) => void;
  onCopy?: () => void;
  onDuplicate?: () => void;
  onExportCsv?: () => void;
  canEdit?: boolean;
}

export function BulkActionBar({
  count,
  total,
  onDelete,
  onClear,
  onSelectAll,
  statusOptions,
  onSetStatus,
  onMarkDone,
  otherOptionColumns,
  onSetOptionValue,
  onCopy,
  onDuplicate,
  onExportCsv,
  canEdit,
}: BulkActionBarProps) {
  if (count <= 0) return null;
  const hasOptions = Boolean(canEdit && onSetStatus && statusOptions && statusOptions.length > 0);

  return (
    <div className="bulk-action-bar pointer-events-none absolute inset-x-0 bottom-5 z-30 flex justify-center px-3 pb-[env(safe-area-inset-bottom)]">
      <div className="bulk-action-panel pointer-events-auto flex max-w-full items-center gap-1.5 overflow-x-auto rounded-lg border border-primary/40 bg-card px-2 py-1.5 scrollbar-thin">
        <span className="shrink-0 pl-1.5 font-mono text-[11px] tabular text-muted-foreground">
          <span className="text-foreground">{count}</span>
          {total > count && onSelectAll ? (
            <button type="button" onClick={onSelectAll} className="ml-1 text-primary hover:underline" title="Выбрать все строки в фильтре">
              / {total}
            </button>
          ) : (
            <span> выбрано</span>
          )}
        </span>

        {hasOptions && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 shrink-0 gap-1.5 rounded-full px-3 sm:h-8">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Статус
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center">
              {statusOptions!.map((opt) => (
                <DropdownMenuItem key={opt.value} onClick={() => onSetStatus!(opt.value)}>
                  <StatusBadge value={opt.value} options={statusOptions!} showTick />
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {canEdit && onMarkDone && hasOptions && (
          <Button variant="outline" size="sm" className="h-9 shrink-0 gap-1.5 rounded-full px-3 text-success hover:text-success sm:h-8" onClick={onMarkDone} title="Отметить выбранные как «Готово»">
            <CheckCheck className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Готово</span>
          </Button>
        )}

        {canEdit && otherOptionColumns && otherOptionColumns.length > 0 && onSetOptionValue && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 shrink-0 gap-1.5 rounded-full px-3 sm:h-8" title="Заполнить поле у всех выбранных">
                <MoreHorizontal className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Заполнить</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center">
              <DropdownMenuLabel>Заполнить у {count} строк</DropdownMenuLabel>
              {otherOptionColumns.map(({ column, options }) => (
                <DropdownMenuSub key={column.key}>
                  <DropdownMenuSubTrigger>{column.label}</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {options.length === 0 && <DropdownMenuItem disabled>Нет вариантов</DropdownMenuItem>}
                    {options.map((opt) => (
                      <DropdownMenuItem key={opt.value} onClick={() => onSetOptionValue(column.key, opt.value)}>
                        <StatusBadge value={opt.value} options={options} />
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-muted-foreground" onClick={() => onSetOptionValue(column.key, "")}>
                      Очистить
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {onCopy && (
          <Button variant="ghost" size="sm" className="h-9 shrink-0 gap-1.5 rounded-full px-2.5 sm:h-8" onClick={onCopy} title="Скопировать выбранные строки (TSV)">
            <Copy className="h-3.5 w-3.5" />
            <span className="hidden md:inline">Копировать</span>
          </Button>
        )}
        {canEdit && onDuplicate && (
          <Button variant="ghost" size="sm" className="h-9 shrink-0 gap-1.5 rounded-full px-2.5 sm:h-8" onClick={onDuplicate} title="Дублировать выбранные строки">
            <CopyPlus className="h-3.5 w-3.5" />
            <span className="hidden md:inline">Дублировать</span>
          </Button>
        )}
        {onExportCsv && (
          <Button variant="ghost" size="sm" className="h-9 shrink-0 gap-1.5 rounded-full px-2.5 sm:h-8" onClick={onExportCsv} title="Экспорт выбранных строк в CSV">
            <Download className="h-3.5 w-3.5" />
            <span className="hidden md:inline">CSV</span>
          </Button>
        )}

        <Button variant="destructive" size="sm" className="h-9 shrink-0 gap-1.5 rounded-full px-3 sm:h-8" onClick={onDelete} disabled={!canEdit}>
          <Trash2 className="h-3.5 w-3.5" />
          <span className="hidden xs:inline">Удалить</span>
        </Button>
        <button
          type="button"
          onClick={onClear}
          className="mr-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:h-8 sm:w-8"
          title="Снять выделение (Esc)"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
