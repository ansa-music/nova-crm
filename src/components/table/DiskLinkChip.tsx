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
        "status-pill inline-flex max-w-full items-center gap-1 truncate rounded-full border border-primary/40 bg-primary/12 px-2 py-0.5 text-[11px] font-medium text-primary",
        className
      )}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <HardDrive className="h-3 w-3 shrink-0" />
      <span className="truncate">Диск</span>
    </a>
  );
}
