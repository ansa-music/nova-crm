import { useMemo, useState } from "react";
import { Loader2, PenLine, Search } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { useWorkspace } from "@/hooks/useWorkspace";
import { setOsManagedDesks } from "@/services/workspaceService";
import { setDeskTechEditable } from "@/services/rows/osExempt";
import { setSupabaseOsManaged } from "@/services/rows/rowsMigrationService";
import { usesSupabaseRows } from "@/services/rows/rowsBackend";
import { cn } from "@/utils/cn";
import { firestoreErrorText } from "@/utils/dbError";
import { personLabel, worksAsTechnician } from "@/utils/peopleDesks";

/**
 * «Правка столов» — кнопка Owner на «Столах» (просьба Nurba 23.09.2026):
 * - общий выключатель «Заказы ведёт ОС»: выключил — технари снова правят
 *   свои столы сами (статус, сумму, строки);
 * - «выборочно» — пока заказы ведёт ОС, отдельным технарям можно разрешить
 *   править свой стол самим (page.techEditable + rows_os_exempt).
 * Заказы, которые ОС выдал со своего стола, это не открывает: их по-прежнему
 * ведёт ОС — так держит база.
 */
export function DeskEditAccessButton() {
  const { activeWorkspaceId, activeWorkspace, pages, members } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const osManaged = Boolean(activeWorkspace?.osManagedDesks);

  const desks = useMemo(() => {
    const q = query.trim().toLowerCase();
    return pages
      .filter((p) => !p.osDesk && !p.isDashboard && !p.inactive && p.responsibleUserId)
      .map((p) => {
        const member = members.find((m) => m.uid === p.responsibleUserId);
        return { page: p, member, name: personLabel(member) || p.name };
      })
      .filter((d) => d.member && d.member.status === "active" && worksAsTechnician(d.member) && d.member.role !== "owner")
      .filter((d) => !q || `${d.name} ${d.page.name}`.toLowerCase().includes(q))
      .sort((a, b) => Number(Boolean(b.page.techEditable)) - Number(Boolean(a.page.techEditable)) || a.name.localeCompare(b.name, "ru"));
  }, [pages, members, query]);
  const exemptCount = pages.filter((p) => p.techEditable && !p.osDesk && !p.inactive).length;

  async function toggleGlobal(next: boolean) {
    if (!activeWorkspaceId) return;
    setBusy("__global");
    try {
      // Сначала база — правило держит она; потом интерфейс.
      if (usesSupabaseRows(activeWorkspaceId)) await setSupabaseOsManaged(activeWorkspaceId, next);
      await setOsManagedDesks(activeWorkspaceId, next);
      toast.success(next ? "Заказы ведёт ОС — технари правят только свои поля" : "Технари снова правят свои столы сами");
    } catch (error) {
      toast.error(firestoreErrorText(error, "Не удалось переключить"));
    } finally {
      setBusy(null);
    }
  }

  async function toggleDesk(pageId: string, next: boolean, name: string) {
    if (!activeWorkspaceId) return;
    setBusy(pageId);
    try {
      await setDeskTechEditable(activeWorkspaceId, pageId, next);
      toast.success(next ? `${name} правит свой стол сам` : `${name}: стол снова ведёт ОС`);
    } catch (error) {
      toast.error(firestoreErrorText(error, "Не удалось сохранить"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Button type="button" variant="outline" className="min-h-11 gap-1.5" onClick={() => setOpen(true)}>
        <PenLine className="h-3.5 w-3.5" />
        Правка столов
        {osManaged ? (
          <span className="font-mono text-[11px] tabular text-muted-foreground">{exemptCount ? `ОС · ${exemptCount}` : "ОС"}</span>
        ) : null}
      </Button>
      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent className="flex max-h-[90vh] max-w-xl flex-col">
          <DialogHeader>
            <DialogTitle>Кто правит столы технарей</DialogTitle>
            <DialogDescription>
              Заказы, выданные ОС со своего стола, в любом случае ведёт ОС — это правило базы, выключатель его не трогает.
            </DialogDescription>
          </DialogHeader>

          <div
            className={cn(
              "flex items-start gap-3 rounded-xl border p-3",
              osManaged ? "border-primary/40 bg-primary/5" : "border-border"
            )}
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Заказы ведёт ОС</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {osManaged
                  ? "Включено: технарь не меняет статус и сумму, не заводит и не удаляет строки — ему остаются ссылка на работу и примечание."
                  : "Выключено: каждый технарь правит свой стол сам."}
              </p>
            </div>
            {busy === "__global" ? (
              <Loader2 className="mt-1 h-4 w-4 animate-spin text-muted-foreground" />
            ) : (
              <Switch checked={osManaged} onCheckedChange={(v) => void toggleGlobal(v)} disabled={busy !== null} aria-label="Заказы ведёт ОС" />
            )}
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">Выборочно: правит свой стол сам</p>
              <span className="text-xs text-muted-foreground">
                {exemptCount} из {desks.length}
              </span>
            </div>
            {!osManaged ? (
              <p className="text-xs text-muted-foreground">
                Сейчас действует для всех. Отметки ниже заработают, когда включите «Заказы ведёт ОС».
              </p>
            ) : null}
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Найти технаря" className="h-10 pl-8" />
            </div>
            <ul className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
              {desks.length === 0 && <li className="py-6 text-center text-sm text-muted-foreground">Никого не нашёл.</li>}
              {desks.map((d) => (
                <li key={d.page.id} className="flex min-h-12 items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-accent/40">
                  <MemberAvatar id={d.member?.uid ?? d.page.id} name={d.name} photoURL={d.member?.photoURL} className="h-8 w-8 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{d.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {d.page.name}
                      {d.page.techEditable ? " · правит сам" : ""}
                    </p>
                  </div>
                  {busy === d.page.id ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : (
                    <Switch
                      checked={Boolean(d.page.techEditable)}
                      onCheckedChange={(v) => void toggleDesk(d.page.id, v, d.name)}
                      disabled={busy !== null}
                      aria-label={`${d.name} правит свой стол сам`}
                    />
                  )}
                </li>
              ))}
            </ul>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
