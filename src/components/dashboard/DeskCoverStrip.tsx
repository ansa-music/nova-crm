import { useEffect, useState } from "react";
import { cn } from "@/utils/cn";

export function deskInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const second = parts[1]?.[0] ?? parts[0]?.[1] ?? "";
  return (first + second).toUpperCase() || "—";
}

interface DeskCoverStripProps {
  coverUrl?: string | null;
  name: string;
  className?: string;
  compact?: boolean;
}

export function DeskCoverStrip({ coverUrl, name, className, compact }: DeskCoverStripProps) {
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    setBroken(false);
  }, [coverUrl]);

  const showPhoto = Boolean(coverUrl) && !broken;

  return (
    <div
      className={cn(
        "relative w-full overflow-hidden border-b border-primary/30 bg-primary/5",
        compact ? "h-16" : "h-24 sm:h-28",
        className
      )}
    >
      {showPhoto ? (
        <img
          src={coverUrl ?? ""}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setBroken(true)}
        />
      ) : (
        <div
          className="absolute inset-0 flex items-center justify-center"
          aria-hidden
          style={{
            backgroundImage: [
              "linear-gradient(180deg, hsl(var(--primary) / 0.12), hsl(var(--background) / 0.55))",
              "repeating-linear-gradient(90deg, hsl(var(--primary) / 0.08) 0 1px, transparent 1px 18px)",
              "repeating-linear-gradient(0deg, hsl(var(--primary) / 0.08) 0 1px, transparent 1px 18px)",
            ].join(", "),
          }}
        >
          <span className="pointer-events-none font-mono text-lg tracking-[0.28em] text-primary/70 sm:text-xl">
            {deskInitials(name)}
          </span>
          <span className="pointer-events-none absolute inset-x-3 top-2 h-px bg-primary/35" />
          <span className="pointer-events-none absolute inset-x-3 bottom-2 h-px bg-primary/25" />
        </div>
      )}
    </div>
  );
}
