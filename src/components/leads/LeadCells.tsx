import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/utils/cn";
import { personLabel } from "@/utils/peopleDesks";
import type { WorkspaceMember } from "@/types";

/**
 * Значение с правкой по клику: клик — поле, Enter или уход с поля — запись,
 * Esc — отмена. Пусто — пунктирное «+».
 */
export function EditableText({
  value,
  display,
  onCommit,
  disabled,
  inputMode,
  align = "left",
  placeholder = "+",
  className,
  ariaLabel,
}: {
  value: string;
  display?: string;
  onCommit: (next: string) => Promise<void> | void;
  disabled?: boolean;
  inputMode?: "text" | "tel" | "decimal" | "url";
  align?: "left" | "right";
  placeholder?: string;
  className?: string;
  ariaLabel: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement | null>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    if (editing) {
      doneRef.current = false;
      setDraft(value);
      window.setTimeout(() => ref.current?.select(), 0);
    }
    // Черновик — только при входе в правку.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const finish = (save: boolean) => {
    if (doneRef.current) return;
    doneRef.current = true;
    setEditing(false);
    if (save && draft.trim() !== value.trim()) void onCommit(draft.trim());
  };

  if (editing) {
    return (
      <input
        ref={ref}
        value={draft}
        aria-label={ariaLabel}
        inputMode={inputMode}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            finish(true);
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            finish(false);
          }
        }}
        className={cn(
          "h-7 w-full min-w-0 rounded-md border border-primary bg-background px-1.5 text-[13px] outline-none ring-1 ring-primary",
          align === "right" && "text-right font-mono tabular-nums",
          className
        )}
      />
    );
  }
  const shown = display ?? value;
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={ariaLabel}
      title={disabled ? undefined : "Нажмите, чтобы изменить"}
      onClick={() => setEditing(true)}
      className={cn(
        "flex h-7 w-full min-w-0 items-center rounded-md px-1.5 text-[13px] hover:bg-accent/60 disabled:cursor-default disabled:hover:bg-transparent",
        align === "right" ? "justify-end font-mono text-[12.5px] tabular-nums" : "justify-start",
        className
      )}
    >
      {shown ? <span className="truncate">{shown}</span> : <span className="text-muted-foreground/50">{disabled ? "—" : placeholder}</span>}
    </button>
  );
}

export function OsLabel({ member, fallback }: { member: WorkspaceMember | null; fallback?: string }) {
  if (!member) return <span className="truncate text-[12.5px] text-muted-foreground">{fallback ?? "Без ОС"}</span>;
  const label = personLabel(member);
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <MemberAvatar id={member.uid} name={label} photoURL={member.photoURL} className="h-5 w-5" />
      <span className="truncate text-[12.5px]">{label}</span>
    </span>
  );
}

/** ОС заказа с выбором другого — строка переезжает на его стол. */
export function OsPicker({
  current,
  osMembers,
  onPick,
  disabled,
  fallback,
}: {
  current: WorkspaceMember | null;
  osMembers: readonly WorkspaceMember[];
  onPick: (member: WorkspaceMember) => void;
  disabled?: boolean;
  fallback?: string;
}) {
  if (disabled) {
    return (
      <span className="flex h-7 min-w-0 items-center px-1.5">
        <OsLabel member={current} fallback={fallback} />
      </span>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Сменить ОС"
          className="group flex h-7 w-full min-w-0 items-center justify-between gap-1 rounded-md px-1.5 hover:bg-accent/60"
        >
          <OsLabel member={current} fallback={fallback} />
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
        <DropdownMenuLabel>Передать заказ ОС</DropdownMenuLabel>
        {osMembers.map((m) => (
          <DropdownMenuItem key={m.uid} disabled={m.uid === current?.uid} onSelect={() => onPick(m)}>
            <OsLabel member={m} />
            {m.uid === current?.uid ? <Check className="ml-auto h-3.5 w-3.5" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
