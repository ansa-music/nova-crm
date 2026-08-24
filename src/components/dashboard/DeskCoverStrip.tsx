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
  ratio?: "video" | "strip" | "hero" | "thumb";
}

export function DeskCoverStrip({ coverUrl, name, className, compact, ratio }: DeskCoverStripProps) {
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    setBroken(false);
  }, [coverUrl]);

  const showPhoto = Boolean(coverUrl) && !broken;
  const hero = ratio === "hero";
  const thumb = ratio === "thumb";
  const wide = ratio === "video" || (!compact && !hero && !thumb && ratio !== "strip");

  return (
    <div
      className={cn(
        "relative w-full overflow-hidden bg-muted",
        hero || thumb ? "border-0" : "border-b border-border",
        hero && "aspect-[16/10] min-h-[220px] sm:aspect-[2/1] sm:min-h-[280px]",
        thumb && "aspect-[4/3]",
        !hero && !thumb && (wide ? "aspect-video" : compact ? "h-16" : "h-24 sm:h-28"),
        className
      )}
    >
      {showPhoto ? (
        <img
          src={coverUrl ?? ""}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          decoding="async"
          onError={() => setBroken(true)}
        />
      ) : (
        <div className="desk-cover-placeholder absolute inset-0 flex items-center justify-center" aria-hidden>
          <span
            className={cn(
              "pointer-events-none tracking-[0.18em] text-primary/45",
              thumb ? "text-base font-medium" : "text-2xl font-medium sm:text-3xl"
            )}
          >
            {deskInitials(name)}
          </span>
        </div>
      )}
    </div>
  );
}
