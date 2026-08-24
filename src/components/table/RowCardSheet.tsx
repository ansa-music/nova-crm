import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { StatusBadge } from "@/components/table/StatusBadge";
import { formatCurrency } from "@/utils/format";
import { formatDate } from "@/utils/date";
import { isOptionColumn } from "@/utils/columnOptions";
import type { PageColumn, PageRow } from "@/types";

interface RowCardSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  columns: PageColumn[];
  row: PageRow | null;
}

function isTitleColumn(col: PageColumn) {
  return col.type === "text" || col.type === "email" || col.type === "phone";
}

export function RowCardSheet({ open, onOpenChange, columns, row }: RowCardSheetProps) {
  if (!row) return null;
  const record = row;

  const titleCol = columns.find(isTitleColumn) ?? columns[0];
  const rawTitle = titleCol ? record.cells[titleCol.key] : null;
  const title = rawTitle === null || rawTitle === undefined || String(rawTitle).trim() === ""
    ? "Без названия"
    : String(rawTitle);

  const attributeCols = columns.filter((c) => c.id !== titleCol?.id);
  const featured = attributeCols.filter((c) => c.type === "currency" || isOptionColumn(c.type)).slice(0, 3);
  const rest = attributeCols.filter((c) => !featured.includes(c));

  function renderValue(col: PageColumn) {
    const raw = record.cells[col.key];
    const stringValue = raw === null || raw === undefined ? "" : String(raw);
    if (isOptionColumn(col.type)) {
      return stringValue ? (
        <StatusBadge value={stringValue} options={col.statusOptions ?? []} className="w-fit" />
      ) : (
        <span className="text-sm text-muted-foreground">—</span>
      );
    }
    if (col.type === "currency" && stringValue) {
      return <span className="display text-xl tabular">{formatCurrency(Number(stringValue))}</span>;
    }
    if (col.type === "date" && stringValue) {
      return <span className="text-sm tabular">{formatDate(Number(stringValue), "d MMMM yyyy")}</span>;
    }
    return <span className="whitespace-pre-wrap text-sm">{stringValue || "—"}</span>;
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full max-w-md flex-col p-0">
        <SheetHeader className="border-b border-border/70 px-6 py-5 text-left">
          <p className="eyebrow mb-2 text-primary">Запись</p>
          <SheetTitle className="display text-[1.55rem] font-light leading-tight tracking-[-0.03em]">
            {title}
          </SheetTitle>
        </SheetHeader>
        <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-6 py-5 scrollbar-thin">
          {featured.length > 0 && (
            <div className="flex flex-col gap-4">
              {featured.map((col) => (
                <div key={col.id} className="flex flex-col gap-1">
                  <p className="eyebrow">{col.label}</p>
                  {renderValue(col)}
                </div>
              ))}
            </div>
          )}
          {rest.length > 0 && (
            <div>
              <p className="eyebrow mb-3">Атрибуты</p>
              <div className="flex flex-col">
                {rest.map((col) => (
                  <div key={col.id} className="flex items-start justify-between gap-4 border-t border-border/60 py-2.5">
                    <p className="shrink-0 pt-0.5 text-[12px] text-muted-foreground">{col.label}</p>
                    <div className="min-w-0 text-right">{renderValue(col)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
