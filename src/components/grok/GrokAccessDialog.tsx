import { useMemo, useState } from "react";
import { Loader2, ShieldCheck, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { GrokPeoplePicker, GrokPickerShell } from "@/components/grok/GrokPeoplePicker";
import { cn } from "@/utils/cn";
import { grokPickerCandidates, pickerInitialSelection } from "@/utils/grokPeople";
import type { GrokAccessRequest, WorkspaceMember } from "@/types";

/**
 * Кому открыт аккаунт подписки (Хикс, 11 Labs, Другие). Сверху
 * переключатель «открыт всем» — то же, что пустой список `allowedUids`:
 * «закрыт и никому не открыт» — состояние, в котором аккаунт просто
 * исчезает у всех, и заводить его случайным кликом незачем. Ниже — пикер
 * людей по группам; те, кто уже просит доступ, помечены и отмечаются той же
 * галочкой — сохранение и выдаёт доступ, и закрывает их запрос.
 *
 * Owner и Тимлид в списке не нужны — они видят все аккаунты всегда.
 */
export function GrokAccessDialog({
  title,
  members,
  allowedUids,
  pendingRequests,
  saving,
  onClose,
  onSave,
}: {
  title: string;
  members: WorkspaceMember[];
  allowedUids: string[];
  /** Ожидающие запросы именно к этому аккаунту. */
  pendingRequests: GrokAccessRequest[];
  saving: boolean;
  onClose: () => void;
  onSave: (uids: string[]) => void;
}) {
  const candidates = useMemo(() => grokPickerCandidates(members), [members]);
  const [selected, setSelected] = useState<string[]>(() => pickerInitialSelection(allowedUids, candidates));
  const [openToAll, setOpenToAll] = useState(allowedUids.length === 0);
  const badges = useMemo(() => {
    const out: Record<string, string> = {};
    for (const r of pendingRequests) out[r.uid] = "просит доступ";
    return out;
  }, [pendingRequests]);
  const asking = pendingRequests.filter((r) => candidates.some((m) => m.uid === r.uid)).length;

  return (
    <GrokPickerShell
      icon={<ShieldCheck className="h-4 w-4 shrink-0 text-primary" />}
      title="Доступ к аккаунту"
      description={
        <>
          {title}. Owner, Тимлид и те, кто управляет разделом, видят аккаунт всегда; остальным он либо открыт всем, либо только отмеченным
          — прочие видят название и могут запросить доступ.
        </>
      }
      onClose={onClose}
      footer={
        <>
          <Button className="min-h-11 gap-1.5 sm:min-h-9" disabled={saving} onClick={() => onSave(openToAll ? [] : selected)}>
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {openToAll ? "Открыть всем" : `Сохранить · ${selected.length}`}
          </Button>
          <Button variant="ghost" className="ml-auto min-h-11 sm:min-h-9" disabled={saving} onClick={onClose}>
            Отмена
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <label
          className={cn(
            "flex cursor-pointer items-center gap-3 rounded-xl border p-3",
            openToAll ? "border-primary/30 bg-primary/[0.06]" : "border-border bg-muted/30"
          )}
        >
          <Users className={cn("h-4 w-4 shrink-0", openToAll ? "text-primary" : "text-muted-foreground")} />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">{openToAll ? "Открыт всем" : "Только выбранным"}</span>
            <span className="block text-xs text-muted-foreground">
              {openToAll
                ? "Видят все, кому открыт «Грок лимит». Выключите, чтобы оставить только выбранных."
                : `Отмечено ${selected.length}${asking > 0 ? ` · просят доступ ${asking}` : ""}. Остальные видят название и могут запросить.`}
            </span>
          </span>
          <Switch checked={openToAll} onCheckedChange={setOpenToAll} aria-label="Открыт всем" />
        </label>

        <GrokPeoplePicker candidates={candidates} selected={selected} onChange={setSelected} disabled={openToAll} badges={badges} />
      </div>
    </GrokPickerShell>
  );
}
