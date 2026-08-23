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

export function RowCardSheet({ open, onOpenChange, columns, row }: RowCardSheetProps) {
  if (!row) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full max-w-md">
        <SheetHeader>
          <SheetTitle>Строка целиком</SheetTitle>
        </SheetHeader>
        <div className="mt-4 flex flex-col gap-4 overflow-y-auto scrollbar-thin">
          {columns.map((col) => {
            const raw = row.cells[col.key];
            const stringValue = raw === null || raw === undefined ? "" : String(raw);
            return (
              <div key={col.id} className="flex flex-col gap-1 border-b border-border pb-3">
                <p className="eyebrow">{col.label}</p>
                {isOptionColumn(col.type) ? (
                  stringValue ? (
                    <StatusBadge value={stringValue} options={col.statusOptions ?? []} className="w-fit" />
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )
                ) : col.type === "currency" && stringValue ? (
                  <span className="text-sm font-medium tabular-nums">{formatCurrency(Number(stringValue))}</span>
                ) : col.type === "date" && stringValue ? (
                  <span className="text-sm">{formatDate(Number(stringValue), "d MMMM yyyy")}</span>
                ) : (
                  <span className="whitespace-pre-wrap text-sm">{stringValue || "—"}</span>
                )}
              </div>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
