import { useState } from "react";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { sbPatchRow } from "@/services/rows/supabaseRowStore";
import { firestoreErrorText } from "@/utils/dbError";
import { TECH_LINK_KEY, TECH_NOTE_KEY } from "@/utils/reservedCellKeys";
import type { PageRow } from "@/types";

/**
 * Заказ глазами технаря: что он может, а что ведёт ОС.
 *
 * Статус, сумму, клиента и ОС правит ОС (это держат политики Supabase и
 * триггер `desk_rows_guard`), поэтому в карточке у технаря — ровно его поля:
 * ссылка на сделанную работу и примечание. Плюс просьба «поставьте
 * „Успешку“»: решает её ОС этого заказа, Тимлид или Owner.
 *
 * Поля лежат в ячейках с зарезервированными ключами (`reservedCellKeys.ts`),
 * а не в столбцах: столбец с таким ключом завести нельзя, иначе правило «ему
 * можно только эти два ключа» человек обошёл бы сам.
 */
export function TechOrderPanel({
  row,
  workspaceId,
  me,
  canWrite,
}: {
  row: PageRow;
  workspaceId: string;
  me: string;
  /** Ответственный за этот стол (иначе поля только на просмотр). */
  canWrite: boolean;
}) {
  const [link, setLink] = useState(String(row.cells[TECH_LINK_KEY] ?? ""));
  const [note, setNote] = useState(String(row.cells[TECH_NOTE_KEY] ?? ""));
  const [busy, setBusy] = useState(false);
  const requested = Boolean(row.successRequestedAt);

  async function save(patch: Record<string, string>) {
    if (!canWrite) return;
    setBusy(true);
    try {
      await sbPatchRow(workspaceId, row.deskPageId ?? "", row.tabId ?? "", row.id, { cells: patch });
    } catch (error) {
      toast.error(firestoreErrorText(error, "Не удалось сохранить"));
    } finally {
      setBusy(false);
    }
  }

  async function askSuccess() {
    setBusy(true);
    try {
      await sbPatchRow(workspaceId, row.deskPageId ?? "", row.tabId ?? "", row.id, {
        cells: {},
        successRequestedAt: Date.now(),
        successRequestedBy: me,
      });
      toast.success("Попросили поставить «Успешку»", {
        description: "Увидит ОС этого заказа, Тимлид и Owner.",
      });
    } catch (error) {
      toast.error(firestoreErrorText(error, "Не удалось отправить просьбу"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-muted/30 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">Заказ ведёт ОС</span>
        {requested ? (
          <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning">просьба отправлена</span>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        Статус, сумму и клиента здесь меняет ОС. Ваше — ссылка на работу и примечание.
      </p>

      <label className="flex flex-col gap-1">
        <span className="eyebrow">Ссылка на работу</span>
        <Input
          value={link}
          onChange={(e) => setLink(e.target.value)}
          onBlur={() => link !== String(row.cells[TECH_LINK_KEY] ?? "") && void save({ [TECH_LINK_KEY]: link })}
          placeholder="https://…"
          disabled={!canWrite || busy}
          className="h-9"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="eyebrow">Примечание</span>
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => note !== String(row.cells[TECH_NOTE_KEY] ?? "") && void save({ [TECH_NOTE_KEY]: note })}
          placeholder="Что важно знать по заказу"
          disabled={!canWrite || busy}
          className="h-9"
        />
      </label>

      {canWrite && (
        <Button
          size="sm"
          variant="outline"
          className="min-h-9 self-start"
          onClick={() => void askSuccess()}
          disabled={busy || requested}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {requested ? "Просьба отправлена" : "Попросить «Успешку»"}
        </Button>
      )}
    </div>
  );
}
