import { Link } from "react-router";
import { PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/hooks/useWorkspace";
import { deskModeOf } from "@/services/rows/deskMode";

/**
 * «Правка столов» на «Столах» и «Технарях» (только Owner) — ссылка на
 * отдельную вкладку `/desk-editing` (`DeskEditingPage`): там режим «кто
 * заполняет столы», выборочные отметки и перенос заказов между технарями и
 * ОС. Раньше здесь был диалог, и выборочное разрешение в нём не открывало
 * технарю заказы от ОС — отсюда жалоба «функция есть, но не работает».
 */
export function DeskEditAccessButton() {
  const { activeWorkspace, pages } = useWorkspace();
  const mode = deskModeOf(activeWorkspace);
  const exemptCount = pages.filter((p) => p.techEditable && !p.osDesk && !p.inactive).length;
  const hint = mode === "tech" ? "сами" : mode === "os" ? (exemptCount ? `ОС · ${exemptCount}` : "ОС") : exemptCount ? `· ${exemptCount}` : null;
  return (
    <Button type="button" variant="outline" className="min-h-11 gap-1.5" asChild>
      <Link to="/desk-editing">
        <PenLine className="h-3.5 w-3.5" />
        Правка столов
        {hint ? <span className="font-mono text-[11px] tabular text-muted-foreground">{hint}</span> : null}
      </Link>
    </Button>
  );
}
