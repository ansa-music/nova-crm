import { AlertTriangle, Archive, AtSign, Pencil } from "lucide-react";
import { memberNickValue, nickLabelOf, type NickKind } from "@/services/memberService";
import { cn } from "@/utils/cn";
import { TEAM_GROUP_LABEL, teamGroupOf } from "@/utils/teamGroup";
import { memberHasRole, type StatusOption, type WorkspaceMember } from "@/types";

const TONE: Record<NickKind, string> = {
  os: "border-amber-400/40 bg-amber-400/10 text-amber-300 hover:bg-amber-400/15",
  tech: "border-teal-400/40 bg-teal-400/10 text-teal-200 hover:bg-teal-400/15",
  other: "border-sky-400/40 bg-sky-400/10 text-sky-200 hover:bg-sky-400/15",
};

const PREFIX: Record<NickKind, string> = { os: "ник ОС", tech: "ник технаря", other: "ник" };
const EMPTY: Record<NickKind, string> = { os: "Закрепить ник ОС", tech: "Закрепить ник технаря", other: "Закрепить ник" };

/**
 * Чип ника участника — один на «Пользователи» и «Команде». Цвет по виду ника
 * (ОС янтарный, технарь бирюзовый, «Другие» голубой), и три нештатных
 * состояния: ник удалили из списка (аварийное), ник в «неактуальных»
 * (штатное — человек ушёл) и ник не по роли — остался от прошлой роли
 * (Технаря перевели в Admin, а ник технаря висит).
 */
export function MemberNickChip({
  member,
  kind,
  options,
  eligible,
  locked,
  lockReason,
  onClick,
  className,
}: {
  member: WorkspaceMember;
  kind: NickKind;
  options: StatusOption[];
  /** Положен ли этот ник человеку по его разделу/роли (`canHoldNick`). */
  eligible: boolean;
  locked: boolean;
  lockReason?: string;
  onClick: () => void;
  className?: string;
}) {
  const value = memberNickValue(member, kind);
  const label = nickLabelOf(member, kind, options);
  const option = value ? options.find((o) => o.value === value) : undefined;
  const missing = Boolean(value) && !option;
  const inactive = Boolean(option?.inactive);
  const stale = Boolean(value) && !eligible;
  // Ник технаря у Owner/Admin, которые по-прежнему работают за столом, — не
  // «от прошлой роли»: просто их раздел теперь «Другие», и подписывает ник
  // раздела. Честно говорим именно это.
  const outOfSection = stale && kind === "tech" && memberHasRole(member, "manager");
  const section = TEAM_GROUP_LABEL[teamGroupOf(member)];
  const title = locked
    ? lockReason
    : outOfSection
      ? `Человек в разделе «${section}» — подписывает ник этого раздела, если он есть. Ник технаря можно открепить`
      : stale
        ? "Ник остался от прошлой роли — его можно открепить"
        : value
          ? `Сменить или открепить ${PREFIX[kind]}`
          : EMPTY[kind];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={locked}
      title={title}
      className={cn(
        "inline-flex min-h-11 max-w-full items-center gap-1 rounded-full border px-2.5 text-[11px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-60 sm:min-h-0 sm:px-2 sm:py-0.5",
        missing || stale
          ? "border-warning/50 bg-warning/10 text-warning hover:bg-warning/15"
          : inactive
            ? "border-border/60 bg-muted/20 text-muted-foreground hover:bg-muted/30"
            : value
              ? TONE[kind]
              : "border-dashed border-border text-muted-foreground hover:border-primary/50 hover:text-foreground",
        className
      )}
    >
      {missing || stale ? (
        <AlertTriangle className="h-3 w-3 shrink-0" />
      ) : inactive ? (
        <Archive className="h-3 w-3 shrink-0" />
      ) : (
        <AtSign className="h-3 w-3 shrink-0" />
      )}
      {label ? (
        <span className="truncate">
          {PREFIX[kind]}: <span className="font-semibold">{label}</span>
          {missing ? " — удалён из списка" : outOfSection ? ` — вне раздела` : stale ? " — не по роли" : inactive ? " — неактуальный" : ""}
        </span>
      ) : (
        <span className="truncate">{EMPTY[kind]}</span>
      )}
      <Pencil className="h-3 w-3 shrink-0 opacity-70" />
    </button>
  );
}
