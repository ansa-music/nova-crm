import { Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStudioMode } from "@/config/studio";
import { useUiStore } from "@/store/uiStore";

/**
 * Плашка «Новая версия дизайна» над контентом — чтобы новый вид (NOVA
 * Signature) увидели все, а не только те, кто открыл меню аккаунта (просьба
 * Nurba 12.10.2026). Видна в прежнем виде, пока человек не включил новый или
 * не закрыл плашку; выбор и закрытие — личные, на устройство. Вернуть прежний
 * вид — в меню аккаунта (на телефоне — лист «Ещё»).
 * В «NOVA Studio» плашки нет: у студии свой вид «космос».
 */
export function SkinPromoBanner() {
  const uiSkin = useUiStore((s) => s.uiSkin);
  const dismissed = useUiStore((s) => s.skinPromoDismissed);
  const setUiSkin = useUiStore((s) => s.setUiSkin);
  const dismiss = useUiStore((s) => s.dismissSkinPromo);
  const studio = useStudioMode();

  if (uiSkin !== "classic" || dismissed || studio) return null;

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-primary/30 bg-primary/[0.08] px-3 py-1.5 sm:gap-3 sm:px-4">
      <Sparkles className="h-4 w-4 shrink-0 text-primary" />
      <p className="min-w-0 flex-1 text-[13px] leading-5">
        <span className="font-semibold text-foreground">Новая версия дизайна.</span>{" "}
        <span className="hidden text-muted-foreground sm:inline">
          Частые разделы — в панели сверху, меню короче. Данные и столы те же; вернуть прежний вид можно в меню аккаунта.
        </span>
      </p>
      <Button size="sm" className="h-8 shrink-0" onClick={() => setUiSkin("signature")}>
        Включить
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0 text-muted-foreground"
        aria-label="Скрыть"
        title="Скрыть — включить новый вид можно в меню аккаунта"
        onClick={dismiss}
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
