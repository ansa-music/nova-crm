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

const PAGE_SIZES = [10, 25, 50, 100];

export function TablePagination({ page, pageSize, total, onPageChange, onPageSizeChange }: TablePaginationProps) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);

  return (
    <div className="flex items-center justify-between border-t border-border px-4 py-2 text-sm text-muted-foreground">
      <div className="flex items-center gap-2">
        <span>Строк на странице</span>
        <Select value={String(pageSize)} onValueChange={(v) => onPageSizeChange(Number(v))}>
          <SelectTrigger className="h-7 w-[72px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZES.map((size) => (
              <SelectItem key={size} value={String(size)}>
                {size}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-4">
        <span>
          {from}–{to} из {total}
        </span>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" disabled={page === 0} onClick={() => onPageChange(0)}>
            <ChevronsLeft className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" disabled={page === 0} onClick={() => onPageChange(page - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="px-2 text-xs">
            {page + 1} / {pageCount}
          </span>
          <Button variant="ghost" size="icon" disabled={page >= pageCount - 1} onClick={() => onPageChange(page + 1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" disabled={page >= pageCount - 1} onClick={() => onPageChange(pageCount - 1)}>
            <ChevronsRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
