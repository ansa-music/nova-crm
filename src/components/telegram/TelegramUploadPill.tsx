import { useSyncExternalStore } from "react";
import { useLocation, useNavigate } from "react-router";
import { Loader2 } from "lucide-react";
import { subscribeTgUploadsPulse, tgUploadsPulse } from "@/services/telegram/tgUploadsPulse";

/**
 * Файл уходит в Telegram, а человек ушёл на другую страницу Nova: внизу
 * справа — прогресс и путь обратно в раздел. Библиотеку Telegram не тянет.
 */
export function TelegramUploadPill() {
  const pulse = useSyncExternalStore(subscribeTgUploadsPulse, tgUploadsPulse);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  if (pulse.active === 0 || pathname.startsWith("/telegram")) return null;
  return (
    <button
      type="button"
      onClick={() => navigate(pulse.chatId !== null ? `/telegram?chat=${pulse.chatId}` : "/telegram")}
      className="fixed bottom-20 right-4 z-[60] flex items-center gap-2 rounded-full border border-sky-400/40 bg-card px-3 py-2 text-[12px] font-medium shadow-lg hover:bg-accent md:bottom-6"
    >
      <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-300" />
      Telegram · отправка {Math.round(pulse.progress * 100)}%{pulse.active > 1 ? ` · файлов ${pulse.active}` : ""}
    </button>
  );
}
