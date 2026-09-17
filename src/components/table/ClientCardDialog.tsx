import { useEffect, useState } from "react";
import { Clock3, IdCard, Loader2, NotebookPen, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { parseOptionalNumber } from "@/utils/quickOrder";
import { normalizeRowExtras, type RowExtras } from "@/utils/rowExtras";
import { cn } from "@/utils/cn";

const PERSON_PICKS = [1, 2, 3, 4, 5, 6];
const MINUTE_PICKS = [1, 2, 3, 5, 10];

function numberText(value: number | null | undefined) {
  return value == null ? "" : String(value);
}

/**
 * «Визитка клиента» — what the client asked for that isn't a table column:
 * how many characters, how many minutes, and free-form wishes. Everything is
 * optional; opened from the ID-card button in the client cell.
 */
export function ClientCardDialog({
  open,
  onOpenChange,
  clientName,
  subtitle,
  initial,
  canEdit,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientName: string;
  subtitle?: string | null;
  initial: RowExtras;
  canEdit: boolean;
  onSave: (next: RowExtras | null) => Promise<void>;
}) {
  const [persons, setPersons] = useState("");
  const [minutes, setMinutes] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPersons(numberText(initial.persons));
    setMinutes(numberText(initial.minutes));
    setNote(initial.note ?? "");
    // Only when the dialog opens — live row updates must not wipe typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const personsNum = parseOptionalNumber(persons);
  const minutesNum = parseOptionalNumber(minutes);
  const personsBad = persons.trim() !== "" && personsNum == null;
  const minutesBad = minutes.trim() !== "" && minutesNum == null;
  const next = normalizeRowExtras({ persons: personsNum, minutes: minutesNum, note });
  const changed =
    (next?.persons ?? null) !== (initial.persons ?? null) ||
    (next?.minutes ?? null) !== (initial.minutes ?? null) ||
    (next?.note ?? "") !== (initial.note?.trim() ?? "");

  async function save() {
    if (!canEdit || personsBad || minutesBad) return;
    if (!changed) {
      onOpenChange(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(next);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  function pickChip(active: boolean) {
    return cn(
      "h-8 min-w-8 rounded-full border px-2.5 text-xs font-medium tabular-nums transition-colors disabled:opacity-60",
      active
        ? "border-primary/60 bg-primary/15 text-primary"
        : "border-border bg-background/40 text-muted-foreground hover:bg-accent hover:text-foreground"
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-4 p-5">
        <DialogHeader>
          <p className="eyebrow flex items-center gap-1.5 text-primary">
            <IdCard className="h-3.5 w-3.5" /> Визитка клиента
          </p>
          <DialogTitle className="break-words text-lg">{clientName || "Без названия"}</DialogTitle>
          <DialogDescription>
            {subtitle ? `${subtitle} · ` : ""}всё по желанию: заполните то, что сказал клиент.
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="cc-persons" className="flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5 text-muted-foreground" /> Персонажи
            </Label>
            <div className="flex flex-wrap items-center gap-1.5">
              {PERSON_PICKS.map((n) => (
                <button
                  key={n}
                  type="button"
                  disabled={!canEdit}
                  className={pickChip(personsNum === n)}
                  onClick={() => setPersons(personsNum === n ? "" : String(n))}
                >
                  {n}
                </button>
              ))}
              <Input
                id="cc-persons"
                value={persons}
                onChange={(e) => setPersons(e.target.value)}
                disabled={!canEdit}
                inputMode="numeric"
                autoComplete="off"
                placeholder="другое"
                className={cn("h-8 w-20 text-sm", personsBad && "border-destructive")}
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="cc-minutes" className="flex items-center gap-1.5">
              <Clock3 className="h-3.5 w-3.5 text-muted-foreground" /> Минуты
            </Label>
            <div className="flex flex-wrap items-center gap-1.5">
              {MINUTE_PICKS.map((n) => (
                <button
                  key={n}
                  type="button"
                  disabled={!canEdit}
                  className={pickChip(minutesNum === n)}
                  onClick={() => setMinutes(minutesNum === n ? "" : String(n))}
                >
                  {n}
                </button>
              ))}
              <Input
                id="cc-minutes"
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
                disabled={!canEdit}
                inputMode="decimal"
                autoComplete="off"
                placeholder="другое"
                className={cn("h-8 w-20 text-sm", minutesBad && "border-destructive")}
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="cc-note" className="flex items-center gap-1.5">
              <NotebookPen className="h-3.5 w-3.5 text-muted-foreground" /> Пожелания
            </Label>
            <Textarea
              id="cc-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={!canEdit}
              rows={4}
              placeholder="Стиль, музыка, сроки, кто есть кто — что угодно по желанию"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  void save();
                }
              }}
            />
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            {canEdit ? (
              <>
                <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                  Отмена
                </Button>
                <Button type="submit" disabled={saving || personsBad || minutesBad}>
                  {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Сохранить
                </Button>
              </>
            ) : (
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Закрыть
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
