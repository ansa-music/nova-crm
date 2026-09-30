import type { SyntheticEvent } from "react";
import { ArrowUpRight } from "lucide-react";
import { Link, useLocation } from "react-router";
import { cn } from "@/utils/cn";
import { deskFromLocation, deskNavState } from "@/utils/deskLinks";
import type { DeskLink } from "@/utils/personDeskLinks";

const stop = (e: SyntheticEvent) => e.stopPropagation();

/**
 * «↗» — открыть стол ОС или технаря прямо из ячейки. Гасит mousedown/click:
 * иначе ячейка под ней выделялась бы или открывала правку/выбор технаря.
 */
export function DeskLinkButton({
  link,
  className,
  withText,
}: {
  link: DeskLink | null | undefined;
  className?: string;
  /** Подпись рядом со значком (карточка строки), а не одна иконка. */
  withText?: string;
}) {
  const location = useLocation();
  if (!link) return null;
  return (
    <Link
      to={link.href}
      state={deskNavState(deskFromLocation(location))}
      title={link.label}
      aria-label={link.label}
      data-desk-link=""
      onPointerDown={stop}
      onMouseDown={stop}
      onClick={stop}
      onDoubleClick={stop}
      className={cn(
        withText
          ? "inline-flex min-h-9 items-center gap-1 rounded-md px-2 text-[12.5px] text-primary hover:bg-primary/10"
          : "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-primary/30 bg-primary/[0.06] text-primary hover:bg-primary/20 [@media(pointer:coarse)]:h-7 [@media(pointer:coarse)]:w-7",
        className
      )}
    >
      {withText ? <span className="truncate">{withText}</span> : null}
      <ArrowUpRight className={withText ? "h-3.5 w-3.5 shrink-0" : "h-3.5 w-3.5"} aria-hidden />
    </Link>
  );
}
