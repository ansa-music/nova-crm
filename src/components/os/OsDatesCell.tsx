import { ArrowDownToLine, Send, Store } from "lucide-react";
import { cn } from "@/utils/cn";
import { formatFullMoment, formatShortMoment, formatWaited } from "@/utils/osDates";

export interface OsDatesInfo {
  /** Когда ОС получил заказ (дата строки). */
  receivedAt: number | null;
  /** Когда отдан нынешнему технарю. */
  issuedAt: number | null;
  /** Ник технаря — для подсказки. */
  techName?: string;
  /** Заказ сейчас на «Заказах» (ещё без технаря): open — ждёт откликов, assigned — отдан, едет. */
  exchange?: { status: "open" | "assigned"; since: number | null } | null;
}

/** Текст подсказки — полные даты и сколько заказ ждал выдачи. */
export function osDatesTitle(info: OsDatesInfo): string {
  const lines: string[] = [];
  if (info.receivedAt) lines.push(`Получен: ${formatFullMoment(info.receivedAt)}`);
  if (info.issuedAt) {
    const who = info.techName ? ` · ${info.techName}` : "";
    const waited = info.receivedAt && info.issuedAt >= info.receivedAt ? ` (через ${formatWaited(info.receivedAt, info.issuedAt)})` : "";
    lines.push(`Выдан технарю: ${formatFullMoment(info.issuedAt)}${who}${waited}`);
  } else if (info.exchange) {
    const since = info.exchange.since ? ` с ${formatFullMoment(info.exchange.since)}` : "";
    lines.push(info.exchange.status === "assigned" ? "Отдан с «Заказов» — едет в стол технаря" : `На «Заказах»${since} — ждёт откликов`);
  } else {
    lines.push("Технарю ещё не выдан");
  }
  return lines.join("\n");
}

/**
 * Столбец «Даты» стола ОС: две крошечные строки моноширинным — «получен» и
 * «выдан». Узко (≈112 px) и сразу за именем, поэтому видно без прокрутки;
 * полные даты и «сколько ждал» — в подсказке и в карточке строки.
 */
export function OsDatesCell({ info }: { info: OsDatesInfo }) {
  const { receivedAt, issuedAt, exchange } = info;
  return (
    <span className="flex min-w-0 flex-col justify-center font-mono text-[10.5px] leading-[13px] tabular-nums" title={osDatesTitle(info)}>
      <span className="flex items-center gap-1 whitespace-nowrap text-muted-foreground">
        <ArrowDownToLine className="h-2.5 w-2.5 shrink-0 opacity-70" aria-hidden />
        {receivedAt ? formatShortMoment(receivedAt) : "—"}
      </span>
      <span
        className={cn(
          "flex items-center gap-1 whitespace-nowrap",
          issuedAt ? "text-foreground/85" : exchange ? "text-primary/85" : "text-muted-foreground/55"
        )}
      >
        {issuedAt ? (
          <>
            <Send className="h-2.5 w-2.5 shrink-0 text-success" aria-hidden />
            {formatShortMoment(issuedAt)}
          </>
        ) : exchange ? (
          <>
            <Store className="h-2.5 w-2.5 shrink-0" aria-hidden />
            {exchange.status === "assigned" ? "едет" : "Заказы"}
          </>
        ) : (
          <>
            <Send className="h-2.5 w-2.5 shrink-0 opacity-50" aria-hidden />
            не выдан
          </>
        )}
      </span>
    </span>
  );
}

/** Та же пара дат в одну строку — для «Карточек» на телефоне. */
export function OsDatesInline({ info }: { info: OsDatesInfo }) {
  const { receivedAt, issuedAt, exchange } = info;
  if (!receivedAt && !issuedAt && !exchange) return null;
  return (
    <span className="inline-flex items-center gap-1.5 font-mono tabular-nums" title={osDatesTitle(info)}>
      {receivedAt ? (
        <span className="inline-flex items-center gap-0.5">
          <ArrowDownToLine className="h-3 w-3 opacity-70" aria-hidden />
          {formatShortMoment(receivedAt)}
        </span>
      ) : null}
      {issuedAt ? (
        <span className="inline-flex items-center gap-0.5 text-foreground/85">
          <Send className="h-3 w-3 text-success" aria-hidden />
          {formatShortMoment(issuedAt)}
        </span>
      ) : exchange ? (
        <span className="inline-flex items-center gap-0.5 font-sans text-primary/85">
          <Store className="h-3 w-3" aria-hidden />
          {exchange.status === "assigned" ? "едет" : "на «Заказах»"}
        </span>
      ) : (
        <span className="font-sans opacity-60">не выдан</span>
      )}
    </span>
  );
}
