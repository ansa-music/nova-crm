import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface TablePaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

export const PAGE_SIZES = [25, 50, 100, 200, Infinity];

export function pageSizeLabel(size: number): string {
  return Number.isFinite(size) ? String(size) : "Все";
}

/**
 * Only rendered while paging is switched on (a finite page size). "Все" —
 * the default — needs no bar at all: rows are virtualised, the footer
 * already shows the count, and a permanent 44px strip just ate space.
 * Page size is chosen from the toolbar's «Ещё → Постранично» submenu.
 */
export function TablePagination({ page, pageSize, total, onPageChange, onPageSizeChange }: TablePaginationProps) {
  if (!Number.isFinite(pageSize)) return null;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);

  return (
    <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-t border-border bg-card px-2 text-sm text-muted-foreground sm:h-auto sm:flex-wrap sm:px-4 sm:py-1.5">
      <div className="flex items-center gap-2">
        <span className="hidden sm:inline">На странице</span>
        <Select value={String(pageSize)} onValueChange={(v) => onPageSizeChange(Number(v))}>
          <SelectTrigger className="h-8 w-[76px] sm:h-7">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZES.map((size) => (
              <SelectItem key={String(size)} value={String(size)}>
                {pageSizeLabel(size)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-3">
        <span className="tabular-nums">
          {from}–{to} из {total}
        </span>
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Первая страница" disabled={page === 0} onClick={() => onPageChange(0)}>
            <ChevronsLeft className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Предыдущая страница" disabled={page === 0} onClick={() => onPageChange(page - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="px-1.5 text-xs tabular-nums">
            {page + 1} / {pageCount}
          </span>
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Следующая страница" disabled={page >= pageCount - 1} onClick={() => onPageChange(page + 1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Последняя страница" disabled={page >= pageCount - 1} onClick={() => onPageChange(pageCount - 1)}>
            <ChevronsRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
