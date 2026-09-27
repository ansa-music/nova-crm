import { useEffect, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/sonner";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useTelegramAccess } from "@/services/telegram/telegramAccess";
import { fetchTgChatForRow } from "@/services/telegram/tgChatLinks";
import { grantTgTech, listenTgGrants, listTgGrants, revokeTgTech, tgFunctionMissing, useTgServer } from "@/services/telegram/tgServer";

/**
 * В карточке заказа на столе ОС (просьба Nurba 27.09.2026): «ОС дал заказ
 * технарю и разрешил ему писать клиенту в Telegram». Видно, если к строке
 * привязан чат клиента и аккаунт workspace подключён на сервере.
 */
export function TgTechGrantToggle({ pageId, rowId, techUid, techName }: { pageId: string; rowId: string; techUid: string; techName: string }) {
  const { activeWorkspaceId } = useWorkspace();
  const { profile } = useAuth();
  const { isResolved, actsAsOwner } = usePermissions();
  const access = useTelegramAccess(activeWorkspaceId, profile?.uid ?? null, isResolved);
  const full = access.granted || actsAsOwner;
  const server = useTgServer(activeWorkspaceId, isResolved && full);
  const on = full && server.connected && !tgFunctionMissing();
  const [chatId, setChatId] = useState<number | null>(null);
  const [granted, setGranted] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setChatId(null);
    setGranted(null);
    if (!on || !activeWorkspaceId) return;
    let alive = true;
    const load = async () => {
      const id = await fetchTgChatForRow(activeWorkspaceId, pageId, rowId);
      if (!alive) return;
      setChatId(id);
      if (id === null) return;
      const list = await listTgGrants(activeWorkspaceId, { chatId: id }).catch(() => []);
      if (alive) setGranted(list.some((g) => g.techUid === techUid));
    };
    void load();
    const stop = listenTgGrants(activeWorkspaceId, () => void load());
    return () => {
      alive = false;
      stop();
    };
  }, [on, activeWorkspaceId, pageId, rowId, techUid]);

  if (!on || chatId === null) return null;

  async function toggle(next: boolean) {
    if (!activeWorkspaceId || chatId === null) return;
    setBusy(true);
    try {
      if (next) {
        const tg = await import("@/services/telegram/tgClient");
        const peer = await tg.peerRefOf(chatId).catch(() => {
          throw new Error("Откройте раздел Telegram на этом устройстве — и повторите.");
        });
        const title = tg.tgState().dialogs.find((d) => d.id === chatId)?.title ?? "";
        await grantTgTech(activeWorkspaceId, { chatId, techUid, peer, title, pageId, rowId });
        toast.success(`${techName} может писать этому клиенту в Telegram`);
      } else {
        await revokeTgTech(activeWorkspaceId, chatId, techUid);
        toast.success(`${techName} больше не пишет этому клиенту`);
      }
      setGranted(next);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось");
    } finally {
      setBusy(false);
    }
  }

  return (
    <label className="flex min-h-11 items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm sm:min-h-9">
      <Send className="h-4 w-4 shrink-0 text-sky-300" />
      <span className="min-w-0 flex-1">
        Технарь может писать клиенту в Telegram
        <span className="block text-[11px] text-muted-foreground">Только этому клиенту — другие чаты ему закрыты.</span>
      </span>
      {granted === null || busy ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : (
        <Switch checked={granted} onCheckedChange={(v) => void toggle(v)} aria-label="Технарь может писать клиенту в Telegram" />
      )}
    </label>
  );
}
