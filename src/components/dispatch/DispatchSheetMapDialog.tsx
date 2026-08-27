import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/sonner";
import { updateDispatchSheetMapping } from "@/services/dispatchTechnicianService";
import { loadSheetColumnsForMapping } from "@/services/dispatchSheetWrite";
import { isDispatchColumnMapComplete } from "@/types/dailyDispatch";
import type { DispatchColumnMap, DispatchTechnician, PageColumn, WorkspacePage } from "@/types";

const FIELDS: { key: keyof DispatchColumnMap; label: string }[] = [
  { key: "checkNo", label: "Чек" },
  { key: "amount", label: "Цена" },
  { key: "minutes", label: "Минуты" },
  { key: "character", label: "Персонаж" },
  { key: "os", label: "ОС" },
];

export function DispatchSheetMapDialog({
  workspaceId,
  tech,
  pages,
  onClose,
  onSaved,
}: {
  workspaceId: string;
  tech: DispatchTechnician;
  pages: WorkspacePage[];
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const ownDesks = useMemo(
    () =>
      tech.memberUid
        ? pages.filter((p) => p.responsibleUserId === tech.memberUid).sort((a, b) => a.order - b.order)
        : [],
    [pages, tech.memberUid]
  );
  const sortedPages = useMemo(() => [...pages].sort((a, b) => a.order - b.order), [pages]);
  const [deskTarget, setDeskTarget] = useState<string>(tech.deskTarget ?? "own");
  const [columnMap, setColumnMap] = useState<DispatchColumnMap>(
    tech.columnMap ?? { checkNo: "", amount: "", minutes: "", character: "", os: "" }
  );
  const [columns, setColumns] = useState<PageColumn[]>([]);
  const [saving, setSaving] = useState(false);

  const resolvedPage = useMemo(() => {
    if (deskTarget === "own") return ownDesks[0];
    return pages.find((p) => p.id === deskTarget);
  }, [deskTarget, ownDesks, pages]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const cols = await loadSheetColumnsForMapping(workspaceId, resolvedPage);
      if (!cancelled) setColumns(cols);
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId, resolvedPage]);

  async function handleSave() {
    setSaving(true);
    try {
      const map: DispatchColumnMap = {
        checkNo: columnMap.checkNo,
        amount: columnMap.amount,
        minutes: columnMap.minutes,
        character: columnMap.character,
        os: columnMap.os,
      };
      await updateDispatchSheetMapping(
        workspaceId,
        tech.id,
        deskTarget === "own" ? "own" : deskTarget || null,
        isDispatchColumnMapComplete(map) ? map : map
      );
      toast.success(isDispatchColumnMapComplete(map) ? "Маппинг сохранён" : "Стол сохранён, столбцы ещё не полные");
      await onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Стол для «{tech.nickname}»</DialogTitle>
          <DialogDescription>
            Один раз: куда писать строку после «Принять», и какие столбцы = чек / цена / минуты / персонаж / ОС. По
            имени столбца не угадываем.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="space-y-1.5">
            <Label>Стол</Label>
            <Select value={deskTarget || "own"} onValueChange={setDeskTarget}>
              <SelectTrigger>
                <SelectValue placeholder="Свой стол" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="own">Свой стол</SelectItem>
                {sortedPages.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                    {ownDesks.some((d) => d.id === p.id) ? " · его" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {deskTarget === "own" && !tech.memberUid && (
              <p className="text-xs text-muted-foreground">Привяжи ник к аккаунту — иначе «свой стол» ещё не к чему.</p>
            )}
            {deskTarget === "own" && tech.memberUid && !ownDesks.length && (
              <p className="text-xs text-muted-foreground">У этого аккаунта пока нет своего стола.</p>
            )}
          </div>
          {FIELDS.map((f) => (
            <div key={f.key} className="space-y-1.5">
              <Label>{f.label}</Label>
              <Select
                value={columnMap[f.key] || undefined}
                onValueChange={(v) => setColumnMap((m) => ({ ...m, [f.key]: v }))}
                disabled={!columns.length}
              >
                <SelectTrigger>
                  <SelectValue placeholder={columns.length ? "Столбец" : "Нет столбцов"} />
                </SelectTrigger>
                <SelectContent>
                  {columns.map((c) => (
                    <SelectItem key={c.key} value={c.key}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
