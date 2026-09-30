import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, Wrench } from "lucide-react";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusBadge } from "@/components/table/StatusBadge";
import { cn } from "@/utils/cn";
import { personLabel } from "@/utils/peopleDesks";
import type { StatusOption, WorkspaceMember } from "@/types";

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

/**
 * Цветная пилюля человека, как в таблице Nurba («Менеджер ОС», «Технарь»):
 * цвет — варианта ника (HSL-триплет), без варианта — нейтральная.
 */
export function PersonPill({ color, children, className }: { color: string | null | undefined; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 min-w-0 max-w-full items-center gap-1 rounded-full border px-1.5",
        !color && "border-border bg-muted/60",
        className
      )}
      style={color ? { backgroundColor: `hsl(${color} / 0.16)`, borderColor: `hsl(${color} / 0.35)` } : undefined}
    >
      {children}
    </span>
  );
}

/**
 * Ник строкой, как в отчёте Excel: цветная точка (цвет варианта ника) и ник —
 * без пилюли, рамки и аватара. `tone="warning"` — с ником что-то не так.
 */
export function NickText({
  label,
  color,
  tone,
  title,
  className,
}: {
  label: string;
  color: string | null | undefined;
  tone?: "warning" | "muted";
  title?: string;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)} title={title}>
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: color ? `hsl(${color})` : "hsl(var(--muted-foreground) / 0.45)" }}
        aria-hidden
      />
      <span className={cn("truncate text-[13px]", tone === "warning" && "text-warning", tone === "muted" && "text-muted-foreground")}>{label}</span>
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
  pill,
  dot,
  className,
}: {
  current: WorkspaceMember | null;
  osMembers: readonly WorkspaceMember[];
  onPick: (member: WorkspaceMember) => void;
  disabled?: boolean;
  fallback?: string;
  /** Нарисовать ОС цветной пилюлей (цвет варианта его ника); `undefined` — как раньше. */
  pill?: { color: string | null };
  /** Ник строкой с цветной точкой — клетка «Общей таблицы» в виде отчёта. */
  dot?: { color: string | null };
  /** Классы кнопки/подписи — клетка таблицы задаёт высоту и отступы сама. */
  className?: string;
}) {
  const label =
    dot && current ? <NickText label={personLabel(current)} color={dot.color} /> : <OsLabel member={current} fallback={fallback} />;
  const shown = pill && current ? <PersonPill color={pill.color}>{label}</PersonPill> : label;
  if (disabled) {
    return (
      <span className={cn("flex h-7 min-w-0 items-center px-1.5", className)}>
        {shown}
      </span>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Сменить ОС"
          className={cn("group flex h-7 w-full min-w-0 items-center justify-between gap-1 rounded-md px-1.5 hover:bg-accent/60", className)}
        >
          {shown}
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

/**
 * Статус заказа цветной пилюлей целиком (без «Гото…») с выбором другого.
 * `derived` — статус взят у технаря: у ОС строка ещё «на утверждении».
 */
export function LeadStatusPicker({
  value,
  options,
  derived,
  onPick,
  disabled,
  size = "sm",
  variant = "pill",
}: {
  value: string;
  options: readonly StatusOption[];
  derived?: boolean;
  onPick: (value: string) => void;
  disabled?: boolean;
  size?: "sm" | "md";
  /**
   * `cell` — клетка «Общей таблицы» в виде отчёта: статус заливает клетку
   * целиком своим цветом (как условное форматирование в Excel), без пилюли.
   */
  variant?: "pill" | "cell";
}) {
  if (variant === "cell") {
    return <StatusCellPicker value={value} options={options} derived={derived} onPick={onPick} disabled={disabled} />;
  }
  const known = options.some((o) => o.value === value);
  const pill = known ? (
    <StatusBadge value={value} options={[...options]} className={cn("max-w-none", size === "md" && "px-3 py-1 text-[12px]")} />
  ) : (
    <span className="inline-flex items-center rounded-full border border-dashed border-border px-2.5 py-[3px] text-[11px] text-muted-foreground">
      {value || "без статуса"}
    </span>
  );
  const mark = derived ? (
    <span className="inline-flex shrink-0 items-center text-muted-foreground" title="Так у технаря. У ОС заказ ещё «на утверждении»">
      <Wrench className="h-3 w-3" aria-label="по технарю" />
    </span>
  ) : null;
  if (disabled) {
    return (
      <span className="flex h-7 min-w-0 items-center gap-1 px-1">
        {pill}
        {mark}
      </span>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Сменить статус"
          title={derived ? "Статус у технаря. Нажмите, чтобы поставить статус заказу" : "Сменить статус"}
          className="group flex h-7 min-w-0 max-w-full items-center gap-1 rounded-md px-1 hover:bg-accent/60"
        >
          {pill}
          {mark}
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100" />
        </button>
      </DropdownMenuTrigger>
      <StatusMenu value={value} options={options} onPick={onPick} />
    </DropdownMenu>
  );
}

function StatusMenu({ value, options, onPick }: { value: string; options: readonly StatusOption[]; onPick: (value: string) => void }) {
  const active = options.filter((o) => !o.inactive || o.value === value);
  return (
    <DropdownMenuContent align="start" className="max-h-80 min-w-[12rem] overflow-y-auto">
      <DropdownMenuLabel>Статус заказа</DropdownMenuLabel>
      {active.map((o) => (
        <DropdownMenuItem key={o.value} onSelect={() => onPick(o.value)}>
          <StatusBadge value={o.value} options={[...options]} className="max-w-none" />
          {o.value === value ? <Check className="ml-auto h-3.5 w-3.5" /> : null}
        </DropdownMenuItem>
      ))}
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => onPick("")} className="text-muted-foreground">
        Без статуса
      </DropdownMenuItem>
    </DropdownMenuContent>
  );
}

/** Статус заливкой клетки: цвет варианта на всю клетку, точка и слово. */
function StatusCellPicker({
  value,
  options,
  derived,
  onPick,
  disabled,
}: {
  value: string;
  options: readonly StatusOption[];
  derived?: boolean;
  onPick: (value: string) => void;
  disabled?: boolean;
}) {
  const option = options.find((o) => o.value === value) ?? null;
  const style = option ? { backgroundColor: `hsl(${option.color} / 0.16)`, color: `hsl(${option.color})` } : undefined;
  const body = (
    <>
      {option ? (
        <>
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: `hsl(${option.color})` }} aria-hidden />
          <span className="truncate font-medium">{option.label}</span>
        </>
      ) : (
        <span className="truncate text-muted-foreground">{value || "без статуса"}</span>
      )}
      {derived ? (
        <span className="inline-flex shrink-0 items-center opacity-80" title="Так у технаря. У ОС заказ ещё «на утверждении»">
          <Wrench className="h-3 w-3" aria-label="по технарю" />
        </span>
      ) : null}
    </>
  );
  const base = "flex h-full w-full min-w-0 items-center gap-1.5 px-2 text-left text-[12.5px]";
  if (disabled) {
    return (
      <span className={base} style={style}>
        {body}
      </span>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Сменить статус"
          title={derived ? "Статус у технаря. Нажмите, чтобы поставить статус заказу" : "Сменить статус"}
          className={cn(base, "group outline-none hover:brightness-125 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary")}
          style={style}
        >
          {body}
          <ChevronDown className="ml-auto h-3 w-3 shrink-0 opacity-0 group-hover:opacity-80 [@media(hover:none)]:opacity-80" />
        </button>
      </DropdownMenuTrigger>
      <StatusMenu value={value} options={options} onPick={onPick} />
    </DropdownMenu>
  );
}
