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
  /** Money «Готово vs Общий» 0–100. Omit or null when there is no leaderboard total. */
  progressPercent?: number | null;
}

function CoverProgressRing({ percent }: { percent: number }) {
  const r = 42;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, percent));
  const dash = (clamped / 100) * c;
  return (
    <svg
      viewBox="0 0 100 100"
      className="pointer-events-none absolute left-1/2 top-[34%] z-[3] h-[48%] w-[48%] -translate-x-1/2 -translate-y-1/2 -rotate-90 drop-shadow-[0_1px_3px_rgba(0,0,0,0.55)]"
      aria-hidden
    >
      <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth="3.25" />
      <circle
        cx="50"
        cy="50"
        r={r}
        fill="none"
        className="text-primary"
        stroke="currentColor"
        strokeWidth="3.25"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${c}`}
      />
    </svg>
  );
}

export function DeskCoverStrip({ coverUrl, name, className, compact, ratio, progressPercent }: DeskCoverStripProps) {
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
      {thumb && typeof progressPercent === "number" && Number.isFinite(progressPercent) ? (
        <CoverProgressRing percent={progressPercent} />
      ) : null}
    </div>
  );
}
