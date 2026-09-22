import { useState } from "react";
import { Eye, EyeOff, Loader2, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/sonner";
import { setAllDesksVisibility } from "@/services/pageService";
import { confirmDialog } from "@/utils/appDialog";
import type { WorkspaceMember, WorkspacePage } from "@/types";

/**
 * «Доступ ко всем столам» — кнопка ТОЛЬКО у Owner на «Столах»: разом открыть
 * все столы на просмотр или разом закрыть. Это тот же переключатель, что у
 * каждого стола («открыт для всех / скрыт», `togglePageVisibility`), только
 * на все столы одной пачкой:
 * - открыть — просмотр всем участникам, ПРАВКА НЕ ВЫДАЁТСЯ (editableUsers не
 *   трогаем: уже выданные права правки остаются как были);
 * - закрыть — стол видит только ответственный, остальные — по кнопке
 *   «Запросить просмотр»; выданные раньше просмотры снимаются.
 * Столы ОС не трогаем: их открывает сам ОС, руководство смотрит их и так.
 */
export function AllDesksAccessButton({
  workspaceId,
  pages,
  members,
}: {
  workspaceId: string;
  pages: WorkspacePage[];
  members: WorkspaceMember[];
}) {
  const [busy, setBusy] = useState(false);
  const desks = pages.filter((p) => !p.osDesk);
  // Считаем по НАСТОЯЩЕМУ доступу (allowedUsers), а не по флагу «скрыт»:
  // правила смотрят только список, и стол с флагом «открыт», но без людей в
  // списке, на деле закрыт.
  const activeUids = members.filter((m) => m.status === "active" && Boolean(m.uid)).map((m) => m.uid);
  let open = 0;
  let closed = 0;
  for (const page of desks) {
    const allowed = new Set(page.allowedUsers ?? []);
    const others = activeUids.filter((uid) => uid !== page.responsibleUserId);
    if (others.every((uid) => allowed.has(uid))) open += 1;
    else if (others.every((uid) => !allowed.has(uid))) closed += 1;
  }
  const partly = desks.length - open - closed;

  async function apply(makeOpen: boolean) {
    const ok = await confirmDialog(
      makeOpen
        ? {
            title: `Открыть все столы на просмотр (${desks.length})?`,
            description:
              "Каждый участник сможет смотреть любой стол без запроса. Править чужие столы это не даёт — права правки остаются как были. Кто придёт в команду позже, нажмите кнопку ещё раз.",
            confirmLabel: "Открыть все",
          }
        : {
            title: `Закрыть все столы (${desks.length})?`,
            description:
              "Стол будет видеть только его ответственный. Остальные смогут смотреть только после разрешения — по кнопке «Запросить просмотр». Все выданные раньше просмотры снимутся.",
            confirmLabel: "Закрыть все",
            destructive: true,
          }
    );
    if (!ok) return;
    setBusy(true);
    try {
      const count = await setAllDesksVisibility(workspaceId, desks, makeOpen, activeUids);
      toast.success(makeOpen ? `Открыто на просмотр: ${count}` : `Закрыто: ${count}`, {
        description: makeOpen ? "Смотреть может каждый, править — как раньше." : "Смотреть — только по запросу.",
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось изменить доступ к столам");
    } finally {
      setBusy(false);
    }
  }

  if (desks.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" className="min-h-11 gap-1.5" disabled={busy}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LockKeyhole className="h-3.5 w-3.5" />}
          Доступ ко всем
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Сейчас: открыто всем {open}, закрыто {closed}
          {partly > 0 ? `, частично ${partly}` : ""}. Столы ОС — отдельно, у самих ОС.
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void apply(true)} className="items-start gap-2">
          <Eye className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <span className="block font-medium">Открыть все на просмотр</span>
            <span className="block text-[11px] text-muted-foreground">Смотрят все, правка — только у кого была</span>
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void apply(false)} className="items-start gap-2">
          <EyeOff className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <span className="block font-medium">Закрыть все</span>
            <span className="block text-[11px] text-muted-foreground">Смотреть — только по запросу к ответственному</span>
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
