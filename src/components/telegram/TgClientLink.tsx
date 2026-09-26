import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, ChevronDown, Loader2, Search, Unlink, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "@/components/ui/sonner";
import type { TgChatClient, TgClientFound, TgClientTarget } from "@/services/telegram/tgChatLinks";
import type { TgDialog } from "@/services/telegram/tgClient";
import { cn } from "@/utils/cn";

/**
 * Чат ↔ клиент (просьба Nurba 26.09.2026: «прикрепить чат к клиенту — с
 * переадресацией к нему»). В шапке переписки: не привязан — «Клиент» с
 * поиском по столам (имя или телефон); привязан — имя клиента, нажатие
 * открывает его строку на столе вместе с визиткой, «▾» — сменить или отвязать.
 */

export interface TgClientTools {
  clients: Record<number, TgChatClient>;
  find: (query: string) => Promise<TgClientFound[]>;
  /** Имя, телефон и где лежит (стол · вкладка) — для выдачи поиска. */
  describe: (found: { pageId: string; tabId: string; cells: Record<string, string> }) => { name: string | null; phone: string | null; place: string };
  setClient: (dialog: TgDialog, target: TgClientTarget | null) => Promise<void>;
  /** Перейти к клиенту: стол, строка и открытая визитка. */
  open: (client: TgChatClient) => void;
}

/** Строка для поиска по умолчанию: имя чата без смайлов и пометок. */
function defaultQuery(title: string): string {
  return title
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^\p{L}\p{N}+\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

function ClientSearch({ dialog, tools, onPicked }: { dialog: TgDialog; tools: TgClientTools; onPicked: (target: TgClientTarget) => void }) {
  const [query, setQuery] = useState(() => defaultQuery(dialog.title));
  const [results, setResults] = useState<TgClientFound[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const q = query.trim();
    const my = ++seq.current;
    if (q.length < 2) {
      setResults(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(() => {
      tools
        .find(q)
        .then((found) => {
          if (seq.current !== my) return;
          setResults(found);
          setError(null);
        })
        .catch((e: Error) => {
          if (seq.current !== my) return;
          setError(e.message);
          setResults(null);
        })
        .finally(() => {
          if (seq.current === my) setLoading(false);
        });
    }, 350);
    return () => clearTimeout(timer);
  }, [query, tools]);

  return (
    <div className="space-y-1.5">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Имя или телефон клиента" className="h-8 pl-7 text-sm" autoFocus />
        {loading && <Loader2 className="absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />}
      </div>
      <div className="max-h-72 overflow-y-auto">
        {error && <p className="p-2 text-[12px] text-destructive">{error}</p>}
        {!error && query.trim().length < 2 && <p className="p-2 text-[12px] text-muted-foreground">Введите хотя бы 2 знака: имя или номер телефона.</p>}
        {!error && results && results.length === 0 && (
          <p className="p-2 text-[12px] text-muted-foreground">Не нашлось. Ищите так, как клиент записан на столе: имя или номер.</p>
        )}
        {results?.map((r) => {
          const d = tools.describe(r);
          return (
            <button
              key={`${r.pageId}:${r.tabId}:${r.rowId}`}
              type="button"
              className="flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-accent"
              onClick={() => onPicked({ pageId: r.pageId, tabId: r.tabId, rowId: r.rowId, label: [d.name, d.phone].filter(Boolean).join(" · ") || "Клиент без имени" })}
            >
              <span className="w-full truncate text-[13px] font-medium">{d.name ?? "Без имени"}</span>
              <span className="w-full truncate text-[11px] text-muted-foreground">
                {[d.phone, d.place].filter(Boolean).join(" · ")}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function TgClientButton({ dialog, tools }: { dialog: TgDialog; tools: TgClientTools }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const client = tools.clients[dialog.id] ?? null;
  const name = client ? client.label.split(" · ")[0] || "Клиент" : null;

  async function pick(target: TgClientTarget | null) {
    setBusy(true);
    try {
      await tools.setClient(dialog, target);
      setOpen(false);
      if (target) {
        const linked: TgChatClient = { chatId: dialog.id, ...target, boundBy: "", boundAt: Date.now() };
        toast.success(`Чат привязан к клиенту ${target.label}`, { action: { label: "Открыть", onClick: () => tools.open(linked) } });
      } else {
        toast.success("Клиент отвязан от чата");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось привязать клиента");
    } finally {
      setBusy(false);
    }
  }

  const popover = (
    <PopoverContent align="end" className="w-72 p-2">
      {client && (
        <div className="mb-2 rounded-md border border-border p-2">
          <p className="text-[11px] text-muted-foreground">Клиент этого чата</p>
          <p className="truncate text-[13px] font-medium">{client.label || "Клиент"}</p>
          <div className="mt-1.5 flex gap-1.5">
            <Button size="sm" className="h-7 gap-1 px-2 text-[12px]" data-compact onClick={() => tools.open(client)}>
              <ArrowUpRight className="h-3.5 w-3.5" /> Открыть
            </Button>
            <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-[12px] text-destructive" data-compact disabled={busy} onClick={() => void pick(null)}>
              <Unlink className="h-3.5 w-3.5" /> Отвязать
            </Button>
          </div>
        </div>
      )}
      <p className="px-1 pb-1.5 text-[12px] text-muted-foreground">{client ? "Сменить клиента" : "Найти клиента на столах"}</p>
      <div className={cn(busy && "pointer-events-none opacity-60")}>
        <ClientSearch dialog={dialog} tools={tools} onPicked={(t) => void pick(t)} />
      </div>
    </PopoverContent>
  );

  if (!client) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="shrink-0 gap-1.5" data-compact title="Привязать чат к клиенту на столе">
            <UserRound className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Клиент</span>
          </Button>
        </PopoverTrigger>
        {popover}
      </Popover>
    );
  }

  return (
    <div className="flex shrink-0 items-center overflow-hidden rounded-md border border-primary/30 bg-primary/[0.08]">
      <button
        type="button"
        onClick={() => tools.open(client)}
        className="flex max-w-[8rem] items-center gap-1 px-2 py-1 text-[12px] font-medium text-primary hover:bg-primary/[0.12] sm:max-w-[12rem]"
        title={`Открыть клиента: ${client.label}`}
      >
        <UserRound className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{name}</span>
        <ArrowUpRight className="h-3 w-3 shrink-0 opacity-70" />
      </button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" className="border-l border-primary/20 px-1 py-1 text-primary hover:bg-primary/[0.12]" aria-label="Сменить или отвязать клиента">
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </PopoverTrigger>
        {popover}
      </Popover>
    </div>
  );
}
