import { useMemo, useState } from "react";
import { Check, ChevronDown, Link2, Search, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "@/components/ui/sonner";
import type { TgChatLink } from "@/services/telegram/tgChatLinks";
import type { TgDialog } from "@/services/telegram/tgClient";
import type { StatusOption } from "@/types";
import { cn } from "@/utils/cn";
import { splitOptionsByActivity } from "@/utils/columnOptions";

/**
 * Привязка чата Telegram к нику ОС (просьба Nurba 26.09.2026): кнопка в
 * шапке переписки, цветная метка ника в списке и фильтры «Мои / Без ОС /
 * по нику». Ник — значение варианта «Ответственный» (как в заказах), список
 * ников и цвета — оттуда же.
 */

export interface TgLinking {
  links: Record<number, TgChatLink>;
  /** Все ники ОС (и неактуальные — ради подписи уже привязанных). */
  options: StatusOption[];
  /** Мой ник ОС, если он у меня есть. */
  myOsValue: string | null;
  setLink: (dialog: TgDialog, osValue: string | null) => Promise<void>;
}

export type TgChatFilter = "all" | "mine" | "none" | `os:${string}`;

export function filterDialogsByLink(dialogs: TgDialog[], filter: TgChatFilter, linking: TgLinking | null): TgDialog[] {
  if (!linking || filter === "all") return dialogs;
  if (filter === "none") return dialogs.filter((d) => !linking.links[d.id]);
  const value = filter === "mine" ? linking.myOsValue : filter.slice(3);
  if (!value) return dialogs;
  return dialogs.filter((d) => linking.links[d.id]?.osValue === value);
}

function optionOf(options: StatusOption[], value: string): StatusOption | null {
  return options.find((o) => o.value === value) ?? null;
}

/** Метка ника: точка цветом варианта и подпись. */
export function TgOsChip({ value, options, className }: { value: string; options: StatusOption[]; className?: string }) {
  const option = optionOf(options, value);
  const color = option?.color;
  return (
    <span
      className={cn("inline-flex min-w-0 items-center gap-1 rounded-md px-1.5 py-px text-[10.5px] font-medium", className)}
      style={color ? { backgroundColor: `hsl(${color} / 0.14)`, color: `hsl(${color})` } : undefined}
      title={option ? `ОС: ${option.label}` : "Ник ОС не найден в списке"}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color ? `hsl(${color})` : "currentColor" }} aria-hidden />
      <span className="truncate">{option?.label ?? "ник удалён"}</span>
    </span>
  );
}

function chipClass(on: boolean) {
  return cn(
    "inline-flex h-7 shrink-0 items-center gap-1 rounded-md border px-2 text-[12px] font-medium transition-colors [@media(pointer:coarse)]:h-9",
    on ? "border-primary/30 bg-primary/[0.12] text-primary" : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"
  );
}

/** Фильтры списка чатов: все / мои / без ОС / по нику. */
export function TgChatFilterBar({
  dialogs,
  filter,
  onFilter,
  linking,
}: {
  dialogs: TgDialog[];
  filter: TgChatFilter;
  onFilter: (next: TgChatFilter) => void;
  linking: TgLinking;
}) {
  const [open, setOpen] = useState(false);
  const counts = useMemo(() => {
    const byOs = new Map<string, number>();
    let none = 0;
    for (const d of dialogs) {
      const link = linking.links[d.id];
      if (!link) none += 1;
      else byOs.set(link.osValue, (byOs.get(link.osValue) ?? 0) + 1);
    }
    return { byOs, none };
  }, [dialogs, linking.links]);
  const mine = linking.myOsValue ? (counts.byOs.get(linking.myOsValue) ?? 0) : 0;
  const pickedOs = filter.startsWith("os:") ? filter.slice(3) : null;
  const osList = useMemo(() => {
    const used = [...counts.byOs.keys()];
    return linking.options.filter((o) => used.includes(o.value) || !o.inactive);
  }, [linking.options, counts.byOs]);

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-thin">
      <button type="button" className={chipClass(filter === "all")} aria-pressed={filter === "all"} onClick={() => onFilter("all")}>
        Все <span className="opacity-70">{dialogs.length}</span>
      </button>
      {linking.myOsValue && (
        <button type="button" className={chipClass(filter === "mine")} aria-pressed={filter === "mine"} onClick={() => onFilter("mine")}>
          Мои <span className="opacity-70">{mine}</span>
        </button>
      )}
      <button type="button" className={chipClass(filter === "none")} aria-pressed={filter === "none"} onClick={() => onFilter("none")}>
        Без ОС <span className="opacity-70">{counts.none}</span>
      </button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" className={chipClass(Boolean(pickedOs))} aria-pressed={Boolean(pickedOs)}>
            {pickedOs ? optionOf(linking.options, pickedOs)?.label ?? "ОС" : "ОС"}
            {pickedOs && <span className="opacity-70">{counts.byOs.get(pickedOs) ?? 0}</span>}
            <ChevronDown className="h-3 w-3" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-60 p-1">
          <div className="max-h-72 overflow-y-auto">
            {osList.length === 0 ? (
              <p className="p-3 text-[12px] text-muted-foreground">Ников ОС пока нет — их заводят на «Команде».</p>
            ) : (
              osList.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-accent"
                  onClick={() => {
                    onFilter(`os:${o.value}`);
                    setOpen(false);
                  }}
                >
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: `hsl(${o.color})` }} aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  <span className="text-[11px] text-muted-foreground">{counts.byOs.get(o.value) ?? 0}</span>
                  {pickedOs === o.value && <Check className="h-3.5 w-3.5 text-primary" />}
                </button>
              ))
            )}
          </div>
        </PopoverContent>
      </Popover>
      {pickedOs && (
        <button type="button" className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground" onClick={() => onFilter("all")} aria-label="Сбросить фильтр">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

/** Кнопка в шапке переписки: чей это чат, выбрать / сменить / снять ник ОС. */
export function TgOsLinkButton({ dialog, linking }: { dialog: TgDialog; linking: TgLinking }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const link = linking.links[dialog.id] ?? null;
  const { active } = useMemo(() => splitOptionsByActivity(linking.options, [link?.osValue]), [linking.options, link?.osValue]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? active.filter((o) => o.label.toLowerCase().includes(q)) : active;
    // Мой ник — первым.
    return [...list].sort((a, b) => Number(b.value === linking.myOsValue) - Number(a.value === linking.myOsValue));
  }, [active, query, linking.myOsValue]);

  async function pick(value: string | null) {
    setBusy(true);
    try {
      await linking.setLink(dialog, value);
      setOpen(false);
      setQuery("");
      const label = value ? (optionOf(linking.options, value)?.label ?? value) : null;
      toast.success(label ? `Чат «${dialog.title}» ведёт ОС ${label}` : `Привязка чата «${dialog.title}» снята`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось привязать чат");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        {link ? (
          <button
            type="button"
            className="ml-auto flex shrink-0 items-center gap-1 rounded-md border border-border px-1.5 py-1 hover:bg-accent"
            title="Чей это чат — сменить или снять"
          >
            <span className="hidden text-[11px] text-muted-foreground sm:inline">ОС</span>
            <TgOsChip value={link.osValue} options={linking.options} className="max-w-[9rem]" />
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          </button>
        ) : (
          <Button variant="outline" size="sm" className="ml-auto shrink-0 gap-1.5" data-compact>
            <Link2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Привязать к ОС</span>
            <span className="sm:hidden">ОС</span>
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-2">
        <p className="px-1 pb-2 text-[12px] text-muted-foreground">Кто из ОС ведёт этот чат</p>
        <div className="relative mb-1.5">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Ник ОС" className="h-8 pl-7 text-sm" autoFocus />
        </div>
        <div className="max-h-64 overflow-y-auto">
          {shown.length === 0 && <p className="p-2 text-[12px] text-muted-foreground">{active.length ? "Не нашлось" : "Ников ОС пока нет — их заводят на «Команде»."}</p>}
          {shown.map((o) => {
            const on = link?.osValue === o.value;
            const mine = o.value === linking.myOsValue;
            return (
              <button
                key={o.value}
                type="button"
                disabled={busy}
                className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-accent disabled:opacity-50", on && "bg-primary/[0.08]")}
                onClick={() => void pick(on ? null : o.value)}
              >
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: `hsl(${o.color})` }} aria-hidden />
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {mine && (
                  <span className="flex items-center gap-0.5 text-[10.5px] text-muted-foreground">
                    <UserRound className="h-3 w-3" /> вы
                  </span>
                )}
                {on && <Check className="h-3.5 w-3.5 text-primary" />}
              </button>
            );
          })}
        </div>
        {link && (
          <button
            type="button"
            disabled={busy}
            className="mt-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-destructive hover:bg-destructive/10 disabled:opacity-50"
            onClick={() => void pick(null)}
          >
            <X className="h-3.5 w-3.5" /> Снять привязку
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
