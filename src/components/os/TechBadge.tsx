import { AlertTriangle, Hand, Store } from "lucide-react";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { cn } from "@/utils/cn";
import type { OsTechLeft } from "@/utils/osTechCell";
import { techIdentityTitle, type TechIdentity } from "@/utils/techIdentity";

/**
 * Левая часть ячейки «Технарь» стола ОС (`osTechCellState().left`): бейдж
 * технаря или подпись состояния («не выдан», «ждём отклики»). Одна отрисовка
 * на таблицу, «Карточки» и карточку строки.
 */
export function OsTechLeftView({ left, size = "cell", title }: { left: OsTechLeft; size?: "cell" | "card"; title?: string }) {
  if (left.type === "badge") return <TechBadge identity={left.identity} size={size} />;
  const Icon = left.icon === "store" ? Store : left.icon === "hand" ? Hand : null;
  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center gap-1",
        size === "cell" ? "text-[12px]" : "text-sm",
        left.tone === "warning" ? "text-warning/85" : left.tone === "primary" ? "text-primary" : "text-muted-foreground"
      )}
      title={title}
    >
      {Icon ? <Icon className={cn("shrink-0", size === "cell" ? "h-3.5 w-3.5" : "h-4 w-4")} /> : null}
      <span className="truncate">{left.text}</span>
    </span>
  );
}

/**
 * Технарь в лицо: аватар, ник и настоящее имя (если оно другое). Одна
 * отрисовка на ячейку «Технарь» стола ОС, «Карточки» и карточку строки —
 * раньше ник рисовался как статус («● ник»), неизвестный ник давал «—», а
 * карточка показывала сырое `opt_…`.
 *
 * `size="cell"` — в строку таблицы (аватар 16 px, одна строка), `card` —
 * в карточку строки (аватар 32 px, ник и имя в две строки).
 */
export function TechBadge({
  identity,
  size = "cell",
  className,
}: {
  identity: TechIdentity | null;
  size?: "cell" | "card";
  className?: string;
}) {
  if (!identity) return null;
  const title = techIdentityTitle(identity);
  if (identity.issue === "unknown-nick") {
    return (
      <span
        className={cn(
          "inline-flex min-w-0 items-center gap-1 text-warning",
          size === "cell" ? "text-[12px]" : "text-sm",
          className
        )}
        title={title}
      >
        <AlertTriangle className={cn("shrink-0", size === "cell" ? "h-3.5 w-3.5" : "h-4 w-4")} />
        <span className="truncate">ник не найден</span>
      </span>
    );
  }
  const label = identity.label ?? "технарь";
  const warn = identity.issue ? (
    <AlertTriangle className={cn("shrink-0 text-warning", size === "cell" ? "h-3 w-3" : "h-3.5 w-3.5")} aria-label={title} />
  ) : null;
  const avatar = (
    <MemberAvatar
      id={identity.uid ?? identity.nick}
      name={label}
      photoURL={identity.photoURL}
      className={cn(
        "shrink-0",
        size === "cell" ? "h-4 w-4 [&_*]:text-[8px]" : "h-8 w-8",
        identity.issue && "opacity-60"
      )}
    />
  );
  if (size === "card") {
    return (
      <span className={cn("flex min-w-0 items-center gap-2.5", className)} title={title}>
        {avatar}
        <span className="flex min-w-0 flex-col">
          <span className="flex min-w-0 items-center gap-1">
            <span className="truncate text-sm font-medium">{label}</span>
            {warn}
          </span>
          {identity.issue ? (
            <span className="truncate text-xs text-warning">
              {identity.issue === "no-account" ? "нет аккаунта — закрепите ник на «Команде»" : "ник в неактуальных"}
            </span>
          ) : identity.realName ? (
            <span className="truncate text-xs text-muted-foreground">{identity.realName}</span>
          ) : null}
        </span>
      </span>
    );
  }
  return (
    <span className={cn("flex min-w-0 items-center gap-1.5", className)} title={title}>
      {avatar}
      {/* Имя сжимается первым: ник — то, по чему ОС ищет технаря. */}
      <span className="min-w-0 shrink truncate text-[12.5px] font-medium leading-none">{label}</span>
      {warn}
      {identity.realName ? (
        <span className="min-w-0 shrink-[4] truncate text-[11.5px] leading-none text-muted-foreground">· {identity.realName}</span>
      ) : null}
    </span>
  );
}
