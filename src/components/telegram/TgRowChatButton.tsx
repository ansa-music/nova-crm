import { useEffect, useState } from "react";
import { Send } from "lucide-react";
import { useNavigate } from "react-router";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useTelegramAccess } from "@/services/telegram/telegramAccess";
import { fetchTgChatForRow } from "@/services/telegram/tgChatLinks";

/**
 * Обратный путь «клиент → чат» (просьба Nurba 26.09.2026): в визитке клиента
 * кнопка «Чат в Telegram», если к этой строке привязан чат. Видна только тем,
 * кому открыт раздел Telegram; одна маленькая выборка на открытие карточки,
 * память на минуту. Модуль не тянет библиотеку Telegram.
 */
export function TgRowChatButton({ pageId, rowId }: { pageId: string; rowId: string }) {
  const { activeWorkspaceId } = useWorkspace();
  const { profile } = useAuth();
  const { isResolved } = usePermissions();
  const access = useTelegramAccess(activeWorkspaceId, profile?.uid ?? null, isResolved);
  const granted = access.granted;
  const navigate = useNavigate();
  const [chatId, setChatId] = useState<number | null>(null);

  useEffect(() => {
    setChatId(null);
    if (!granted || !activeWorkspaceId) return;
    let alive = true;
    void fetchTgChatForRow(activeWorkspaceId, pageId, rowId).then((id) => alive && setChatId(id));
    return () => {
      alive = false;
    };
  }, [granted, activeWorkspaceId, pageId, rowId]);

  if (chatId === null) return null;
  return (
    <button
      type="button"
      onClick={() => navigate(`/telegram?chat=${chatId}`)}
      className="inline-flex items-center gap-1 rounded-md border border-sky-400/40 bg-sky-500/10 px-1.5 py-0.5 font-sans text-[11px] font-medium normal-case tracking-normal text-sky-300 hover:bg-sky-500/20"
      title="Открыть переписку с этим клиентом в Telegram"
    >
      <Send className="h-3 w-3" /> Чат в Telegram
    </button>
  );
}
