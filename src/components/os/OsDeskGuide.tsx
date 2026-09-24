import { useState } from "react";
import { AlertTriangle, Check, Info, Store, X } from "lucide-react";
import { cn } from "@/utils/cn";

/** Память «Понятно» — удобство одного человека на устройстве, не данные. */
const GUIDE_KEY = "nova:os-desk-guide:v1";

export function osDeskGuideDismissed(): boolean {
  try {
    return window.localStorage.getItem(GUIDE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setOsDeskGuideDismissed(dismissed: boolean): void {
  try {
    if (dismissed) window.localStorage.setItem(GUIDE_KEY, "1");
    else window.localStorage.removeItem(GUIDE_KEY);
  } catch {
    /* приватный режим — подсказка просто покажется снова */
  }
}

/**
 * Одна строка под шапкой СВОЕГО стола ОС: как выдать заказ и что значат
 * значки в столбце «Технарь» (жалоба Nurba 24.09.2026: «непонятно, что
 * нажимать»; «Утверждение» нигде не объяснялось). «Понятно» прячет строку на
 * этом устройстве, вернуть — «⋯ → Как выдавать заказы».
 *
 * `approvalColor` — HSL-триплет варианта «Утверждение» (как у статуса в ячейке).
 */
export function OsDeskGuide({ approvalColor, onDismiss }: { approvalColor?: string; onDismiss: () => void }) {
  // На телефоне — короткая строка и «Подробнее»: три шага в 375 px не влезают.
  const [more, setMore] = useState(false);
  const dot = approvalColor ? { backgroundColor: `hsl(${approvalColor})` } : undefined;
  return (
    <div className="flex items-start gap-2 border-b border-border/60 bg-primary/[0.05] px-4 py-1.5 text-[12.5px] leading-snug">
      <Info className="mt-[3px] h-3.5 w-3.5 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <p className={cn("text-muted-foreground", !more && "max-md:hidden")}>
          <span className="font-medium text-foreground">Как выдать заказ:</span> ① впишите клиента — встанет
          «Утверждение» ② в столбце «Технарь» — «Выдать…»: всем на «Заказы» или одному технарю ③ статус меняйте
          здесь — у технаря он обновится сам.
        </p>
        <p className={cn("text-muted-foreground md:hidden", more && "hidden")}>
          <span className="font-medium text-foreground">Выдача:</span> «Выдать…» у заказа → всем или одному
          технарю.{" "}
          <button
            type="button"
            onClick={() => setMore(true)}
            className="inline-flex min-h-8 items-center text-primary underline-offset-2 hover:underline"
          >
            Подробнее
          </button>
        </p>
        {/* Легенда значков ячейки «Технарь» — на широком экране, где есть место. */}
        <p className="mt-0.5 hidden flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-muted-foreground lg:flex">
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-muted-foreground" style={dot} aria-hidden />
            Утверждение — не выдан
          </span>
          <span className="inline-flex items-center gap-1">
            <Store className="h-3 w-3" /> ждём отклики
          </span>
          <span className="inline-flex items-center gap-1">
            <Check className="h-3 w-3 text-success" /> у технаря
          </span>
          <span className="inline-flex items-center gap-1">
            <AlertTriangle className="h-3 w-3 text-warning" /> не доехал — нажмите, покажу почему
          </span>
        </p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-[12px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground [@media(pointer:coarse)]:h-9"
        title="Спрятать подсказку. Вернуть — «⋯ → Как выдавать заказы»"
      >
        <span className="max-sm:hidden">Понятно</span>
        <X className="h-3.5 w-3.5 sm:hidden" aria-label="Понятно" />
      </button>
    </div>
  );
}
