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
  ratio?: "video" | "strip";
}

export function DeskCoverStrip({ coverUrl, name, className, compact, ratio }: DeskCoverStripProps) {
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    setBroken(false);
  }, [coverUrl]);

  const showPhoto = Boolean(coverUrl) && !broken;
  const wide = ratio === "video" || (!compact && ratio !== "strip");

  return (
    <div
      className={cn(
        "relative w-full overflow-hidden border-b border-primary/30 bg-[#0B0F19]",
        wide ? "aspect-video" : compact ? "h-16" : "h-24 sm:h-28",
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
              "linear-gradient(180deg, hsl(189 100% 72% / 0.16), #0B0F19 78%)",
              "repeating-linear-gradient(90deg, hsl(189 100% 72% / 0.1) 0 1px, transparent 1px 22px)",
              "repeating-linear-gradient(0deg, hsl(189 100% 72% / 0.08) 0 1px, transparent 1px 22px)",
            ].join(", "),
          }}
        >
          <span className="pointer-events-none font-mono text-2xl tracking-[0.32em] text-primary/75 sm:text-3xl">
            {deskInitials(name)}
          </span>
          <span className="pointer-events-none absolute inset-x-4 top-3 h-px bg-primary/40" />
          <span className="pointer-events-none absolute inset-x-4 bottom-3 h-px bg-primary/25" />
        </div>
      )}
    </div>
  );
}
