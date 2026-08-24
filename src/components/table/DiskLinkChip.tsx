import { HardDrive } from "lucide-react";
import { cn } from "@/utils/cn";

interface DiskLinkChipProps {
  href: string;
  className?: string;
}

export function DiskLinkChip({ href, className }: DiskLinkChipProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={href}
      className={cn(
        "status-pill inline-flex max-w-full items-center justify-center gap-1.5 truncate rounded-full border border-primary/40 bg-primary/12 px-3 py-2 text-xs font-medium text-primary",
        "min-h-10 min-w-[4.5rem] sm:min-h-0 sm:min-w-0 sm:px-2 sm:py-0.5 sm:text-[11px]",
        className
      )}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <HardDrive className="h-3.5 w-3.5 shrink-0 sm:h-3 sm:w-3" />
      <span className="truncate">Диск</span>
    </a>
  );
}
