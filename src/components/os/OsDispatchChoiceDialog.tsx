import { useMemo, useState } from "react";
import { Loader2, Search, Store, UserCheck } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace } from "@/hooks/useWorkspace";
import { osNickLabel } from "@/services/memberService";
import { OS_DESK_COLUMNS } from "@/services/osDeskService";
import { sendOsRowToExchange } from "@/services/rows/osExchange";
import { techTargetProblem } from "@/services/rows/osOrderMirror";
import { sbPatchRow } from "@/services/rows/supabaseRowStore";
import { cn } from "@/utils/cn";
import {
  DEFAULT_STATUS_OPTIONS,
  ensureApprovalStatus,
  ensureDoneStatus,
  findInProgressStatusOption,
  isApprovalStatusValue,
} from "@/utils/columnOptions";
import { firestoreErrorText } from "@/utils/dbError";
import { myDisplayName } from "@/utils/displayName";
import { personLabel, worksAsTechnician } from "@/utils/peopleDesks";
import type { PageRow } from "@/types";

const TECH_KEY = OS_DESK_COLUMNS.find((c) => c.type === "technician")?.key ?? "technician";
const STATUS_KEY = OS_DESK_COLUMNS.find((c) => c.type === "status")?.key ?? "status";

/**
 * «Как отдать заказ?» — спрашивает стол ОС, когда заказ переходит из
 * «Утверждения» в работу (просьба Nurba 23.09.2026):
 * - «Общий» — на биржу «Заказы», всем технарям; отдаёте, когда откликнутся;
 * - «Выборочно» — сразу выбранному технарю (и это увидят Тимлид и Owner во
 *   «Выдачах ОС»).
 * Сам диалог только пишет строку стола ОС (ник технаря) или выставляет заказ
 * на биржу — доставку технарю делает проход стола (useOsDeskDispatch).
 */
export function OsDispatchChoiceDialog({
  row,
  pageId,
  subPageId,
  onClose,
}: {
  row: PageRow;
  pageId: string;
  subPageId: string | null;
  onClose: () => void;
}) {
  const { profile } = useAuth();
  const { activeWorkspaceId, activeWorkspace, members, pages } = useWorkspace();
  const [mode, setMode] = useState<"pick" | "tech">("pick");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const statusOptions = ensureApprovalStatus(ensureDoneStatus(activeWorkspace?.statusOptions ?? DEFAULT_STATUS_OPTIONS));
  const client = String(row.cells.client ?? "").trim() || "Заказ";

  const techs = useMemo(() => {
    const q = query.trim().toLowerCase();
    return members
      .filter((m) => m.status === "active" && m.uid && m.techNickValue && worksAsTechnician(m))
      .map((m) => ({
        uid: m.uid,
        nick: m.techNickValue as string,
        name: personLabel(m) || m.techNick || (m.techNickValue as string),
        problem: techTargetProblem(pages, m.uid),
      }))
      .filter((t) => !q || t.name.toLowerCase().includes(q) || t.nick.toLowerCase().includes(q))
      .sort((a, b) => Number(Boolean(a.problem)) - Number(Boolean(b.problem)) || a.name.localeCompare(b.name, "ru"));
  }, [members, pages, query]);

  /** Статус «Утверждение» снимается: заказ отдают — значит, он в работе. */
  function statusPatch(): Record<string, string> {
    const current = row.cells[STATUS_KEY];
    if (!isApprovalStatusValue(current, statusOptions)) return {};
    const inProgress = findInProgressStatusOption([...statusOptions])?.value;
    return inProgress ? { [STATUS_KEY]: inProgress } : {};
  }

  async function giveToTech(nick: string, name: string) {
    if (!activeWorkspaceId) return;
    setBusy(true);
    try {
      await sbPatchRow(activeWorkspaceId, pageId, subPageId, row.id, { cells: { [TECH_KEY]: nick, ...statusPatch() } });
      toast.success(`${client} → ${name}`, { description: "Заказ уедет в его стол через секунду." });
      onClose();
    } catch (error) {
      toast.error(firestoreErrorText(error, "Не удалось выбрать технаря"));
    } finally {
      setBusy(false);
    }
  }

  async function giveToAll() {
    if (!activeWorkspaceId || !profile) return;
    setBusy(true);
    try {
      const me = members.find((m) => m.uid === profile.uid);
      const osValue = me?.osNickValue ?? "";
      await sendOsRowToExchange({
        workspaceId: activeWorkspaceId,
        pageId,
        tabId: subPageId,
        row,
        me: { uid: profile.uid, name: myDisplayName(profile, members) },
        osValue,
        osLabel: osNickLabel(me, activeWorkspace?.responsibleOptions) ?? osValue,
        technicianUids: members
          .filter((m) => m.status === "active" && m.uid && worksAsTechnician(m))
          .map((m) => m.uid),
        statusOptions,
      });
      toast.success(`${client} — на «Заказах»`, {
        description: "Технари получили уведомление. Отдайте заказ, когда откликнутся, — он приедет к технарю сам.",
      });
      onClose();
    } catch (error) {
      toast.error(firestoreErrorText(error, "Не удалось выставить заказ на «Заказы»"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="flex max-h-[90vh] max-w-lg flex-col">
        <DialogHeader>
          <DialogTitle>Как отдать заказ «{client}»?</DialogTitle>
          <DialogDescription>
            {mode === "pick"
              ? "Заказ в работе. Отдайте его всем на «Заказы» или сразу выбранному технарю."
              : "Выберите технаря — заказ уедет в его стол. Тимлид и Owner увидят выдачу во «Выдачах ОС»."}
          </DialogDescription>
        </DialogHeader>

        {mode === "pick" ? (
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void giveToAll()}
              className="flex min-h-24 flex-col items-start gap-1.5 rounded-xl border border-border p-3 text-left transition-colors hover:border-primary/60 hover:bg-primary/5 disabled:opacity-60"
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Store className="h-4 w-4 text-primary" />}
                Общий
              </span>
              <span className="text-xs text-muted-foreground">На биржу «Заказы» — всем технарям. Отдадите тому, кто откликнется.</span>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setMode("tech")}
              className="flex min-h-24 flex-col items-start gap-1.5 rounded-xl border border-border p-3 text-left transition-colors hover:border-primary/60 hover:bg-primary/5 disabled:opacity-60"
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                <UserCheck className="h-4 w-4 text-primary" />
                Выборочно
              </span>
              <span className="text-xs text-muted-foreground">Сразу одному технарю — выберете его на следующем шаге.</span>
            </button>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Имя или ник" className="h-10 pl-8" />
            </div>
            <ul className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
              {techs.length === 0 && <li className="py-6 text-center text-sm text-muted-foreground">Никого не нашёл.</li>}
              {techs.map((t) => (
                <li key={t.uid}>
                  <button
                    type="button"
                    disabled={busy || Boolean(t.problem)}
                    onClick={() => void giveToTech(t.nick, t.name)}
                    className={cn(
                      "flex min-h-11 w-full flex-col items-start rounded-lg px-2 py-1.5 text-left transition-colors",
                      t.problem ? "cursor-not-allowed opacity-60" : "hover:bg-accent"
                    )}
                  >
                    <span className="text-sm font-medium">{t.name}</span>
                    {t.problem ? <span className="text-xs text-warning">{t.problem}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap justify-between gap-2 border-t border-border/60 pt-3">
          {mode === "tech" ? (
            <Button variant="ghost" disabled={busy} onClick={() => setMode("pick")}>
              Назад
            </Button>
          ) : (
            <span />
          )}
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Позже
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
