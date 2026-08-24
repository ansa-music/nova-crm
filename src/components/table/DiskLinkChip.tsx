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
        "status-pill inline-flex max-w-full items-center justify-center gap-1 truncate rounded-full border border-primary/40 bg-primary/12 px-2 py-0.5 text-[11px] font-medium text-primary",
        "min-h-11 px-2.5 sm:min-h-7 sm:px-2",
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
