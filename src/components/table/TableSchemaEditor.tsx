import { ArrowDown, ArrowUp, Columns3, Eye, EyeOff, Palette, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/table/StatusBadge";
import { BASE_COLUMN_TYPE_LABELS } from "@/utils/columnOptions";
import type { PageColumn, StatusOption } from "@/types";

interface TableSchemaEditorProps {
  columns: PageColumn[];
  statusOptions: StatusOption[];
  canEdit: boolean;
  onAddColumn: () => void;
  onRenameColumn: (colKey: string) => void;
  onToggleHidden: (colKey: string) => void;
  onMoveColumn: (colKey: string, direction: -1 | 1) => void;
  onDeleteColumn: (colKey: string) => void;
  onManageStatuses: () => void;
}

export function TableSchemaEditor({
  columns,
  statusOptions,
  canEdit,
  onAddColumn,
  onRenameColumn,
  onToggleHidden,
  onMoveColumn,
  onDeleteColumn,
  onManageStatuses,
}: TableSchemaEditorProps) {
  const ordered = [...columns].sort((a, b) => a.order - b.order);

  return (
    <div className="flex flex-col gap-7">
      <section className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Столбцы</p>
            <p className="text-xs text-muted-foreground">Добавить, переименовать, скрыть или поменять местами.</p>
          </div>
          {canEdit && (
            <Button variant="outline" size="sm" className="h-8 shrink-0 gap-1.5" onClick={onAddColumn}>
              <Plus className="h-3.5 w-3.5" /> Столбец
            </Button>
          )}
        </div>
        {ordered.length === 0 && <p className="text-sm text-muted-foreground">Пока нет столбцов.</p>}
        <div className="flex flex-col gap-1.5">
          {ordered.map((column, index) => (
            <div
              key={column.id}
              className="flex items-center gap-2 rounded-lg border border-border/70 bg-muted/20 px-2.5 py-2"
            >
              <Columns3 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{column.label}</p>
                <p className="text-[11px] text-muted-foreground">
                  {column.type === "custom" ? "Кастомное" : BASE_COLUMN_TYPE_LABELS[column.type]}
                  {column.hidden ? " · скрыт" : ""}
                </p>
              </div>
              {canEdit && (
                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
                    disabled={index === 0}
                    title="Выше"
                    onClick={() => onMoveColumn(column.key, -1)}
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"
                    disabled={index === ordered.length - 1}
                    title="Ниже"
                    onClick={() => onMoveColumn(column.key, 1)}
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    title="Переименовать"
                    onClick={() => onRenameColumn(column.key)}
                  >
                    <span className="text-[11px] font-medium">Aa</span>
                  </button>
                  <button
                    type="button"
                    className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    title={column.hidden ? "Показать столбец" : "Скрыть столбец"}
                    onClick={() => onToggleHidden(column.key)}
                  >
                    {column.hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                  <button
                    type="button"
                    className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-destructive"
                    title="Удалить столбец"
                    onClick={() => onDeleteColumn(column.key)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3 border-t border-border pt-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Статусы</p>
            <p className="text-xs text-muted-foreground">
              Варианты столбца «Статус», включая «Готово». Добавляются сразу на этот стол.
            </p>
          </div>
          {canEdit && (
            <Button variant="outline" size="sm" className="h-8 shrink-0 gap-1.5" onClick={onManageStatuses}>
              <Plus className="h-3.5 w-3.5" /> Статус
            </Button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {statusOptions.length === 0 ? (
            <span className="text-xs text-muted-foreground">Пока нет статусов — нажмите «Статус».</span>
          ) : (
            statusOptions.map((opt) => <StatusBadge key={opt.value} value={opt.value} options={statusOptions} />)
          )}
        </div>
        {canEdit && (
          <Button variant="ghost" size="sm" className="h-8 w-fit gap-1.5 text-muted-foreground" onClick={onManageStatuses}>
            <Palette className="h-3.5 w-3.5" /> Изменить варианты
          </Button>
        )}
      </section>
    </div>
  );
}
