import { useEffect, useMemo, useState } from "react";
import { Check, HardHat, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "@/components/ui/sonner";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { grantTgTech, listenTgGrants, listTgGrants, revokeTgTech, type TgTechGrant } from "@/services/telegram/tgServer";
import { peerRefOf, type TgDialog } from "@/services/telegram/tgClient";
import type { WorkspaceMember } from "@/types";
import { cn } from "@/utils/cn";
import { matchesPersonQuery } from "@/utils/weekTemplate";
import { personLabel } from "@/utils/peopleDesks";

export interface TgTechGrantTools {
  workspaceId: string;
  /** Технари, которым можно открыть чат. */
  candidates: WorkspaceMember[];
  /** Привязанный к чату клиент — разрешение запомнит его заказ. */
  clientOf: (chatId: number) => { pageId: string; rowId: string } | null;
}

/**
 * «Технарю» в шапке переписки (просьба Nurba 27.09.2026): ОС открывает
 * технарю заказа переписку с этим клиентом. Технарь пишет только в
 * открытые ему чаты — через сервер, своего входа в Telegram у него нет.
 */
export function TgTechGrantButton({ dialog, tools }: { dialog: TgDialog; tools: TgTechGrantTools }) {
  const [open, setOpen] = useState(false);
  const [grants, setGrants] = useState<TgTechGrant[] | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      void listTgGrants(tools.workspaceId, { chatId: dialog.id })
        .then((list) => alive && setGrants(list))
        .catch(() => alive && setGrants([]));
    load();
    const stop = listenTgGrants(tools.workspaceId, load);
    return () => {
      alive = false;
      stop();
    };
  }, [tools.workspaceId, dialog.id]);

  const granted = useMemo(() => new Set((grants ?? []).map((g) => g.techUid)), [grants]);
  const list = useMemo(
    () =>
      tools.candidates
        .filter((m) => matchesPersonQuery(query, [m.name, m.nickname, personLabel(m)]))
        .sort((a, b) => Number(granted.has(b.uid)) - Number(granted.has(a.uid)) || personLabel(a).localeCompare(personLabel(b), "ru")),
    [tools.candidates, query, granted]
  );

  async function toggle(member: WorkspaceMember) {
    setBusy(member.uid);
    try {
      if (granted.has(member.uid)) {
        await revokeTgTech(tools.workspaceId, dialog.id, member.uid);
        setGrants((g) => (g ?? []).filter((x) => x.techUid !== member.uid));
        toast.success(`${personLabel(member)} больше не пишет этому клиенту`);
      } else {
        const peer = await peerRefOf(dialog.id);
        const client = tools.clientOf(dialog.id);
        await grantTgTech(tools.workspaceId, { chatId: dialog.id, techUid: member.uid, peer, title: dialog.title, pageId: client?.pageId, rowId: client?.rowId });
        setGrants((g) => [...(g ?? []), { chatId: dialog.id, techUid: member.uid, title: dialog.title, pageId: null, rowId: null, grantedBy: "", grantedAt: Date.now() }]);
        toast.success(`${personLabel(member)} может писать этому клиенту`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось");
    } finally {
      setBusy(null);
    }
  }

  const count = grants?.length ?? 0;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn("h-8 gap-1.5 px-2 text-[12px]", count > 0 && "border-primary/40 text-primary")}
          title="Открыть переписку с этим клиентом технарю"
        >
          <HardHat className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Технарю</span>
          {count > 0 && <span className="font-mono">{count}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2">
        <p className="px-1 pb-2 text-[12px] text-muted-foreground">Отмеченный технарь пишет этому клиенту в Telegram — и только ему.</p>
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Найти технаря" className="h-8 pl-7 text-[13px]" aria-label="Найти технаря" />
        </div>
        <ul className="max-h-64 overflow-y-auto">
          {grants === null ? (
            <li className="flex justify-center p-3">
              <Loader2 className="h-4 w-4 animate-spin" />
            </li>
          ) : (
            list.map((m) => (
              <li key={m.uid}>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void toggle(m)}
                  className="flex min-h-10 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] hover:bg-accent disabled:opacity-60"
                >
                  <MemberAvatar id={m.uid} name={m.name} nickname={m.nickname} photoURL={m.photoURL} className="h-6 w-6 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{personLabel(m)}</span>
                  {busy === m.uid ? <Loader2 className="h-4 w-4 animate-spin" /> : granted.has(m.uid) && <Check className="h-4 w-4 text-primary" />}
                </button>
              </li>
            ))
          )}
          {grants !== null && list.length === 0 && <li className="p-3 text-center text-[12px] text-muted-foreground">Никого не нашлось.</li>}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
