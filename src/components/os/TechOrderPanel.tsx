import { useState } from "react";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace } from "@/hooks/useWorkspace";
import { sendNotification } from "@/services/notificationService";
import { patchTechOrderRow } from "@/services/pageService";
import { firestoreErrorText } from "@/utils/dbError";
import { myDisplayName } from "@/utils/displayName";
import { pickRowCardColumns } from "@/utils/rowCardColumns";
import { TECH_LINK_KEY, TECH_NOTE_KEY } from "@/utils/reservedCellKeys";
import { memberHasRole, type PageColumn, type PageRow } from "@/types";

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
  pageId,
  subPageId,
  me,
  canWrite,
}: {
  row: PageRow;
  workspaceId: string;
  /** Стол и вкладка, где строка открыта: в режиме Firestore их нет в строке. */
  pageId: string;
  subPageId: string | null;
  me: string;
  /** Ответственный за этот стол (иначе поля только на просмотр). */
  canWrite: boolean;
}) {
  const { members, allPages } = useWorkspace();
  const { profile } = useAuth();
  const [link, setLink] = useState(String(row.cells[TECH_LINK_KEY] ?? ""));
  const [note, setNote] = useState(String(row.cells[TECH_NOTE_KEY] ?? ""));
  const [busy, setBusy] = useState(false);
  const requested = Boolean(row.successRequestedAt);

  async function save(patch: Record<string, string>) {
    if (!canWrite) return;
    setBusy(true);
    try {
      await patchTechOrderRow({
        workspaceId,
        pageId: row.deskPageId || pageId,
        subPageId: row.tabId || subPageId,
        rowId: row.id,
        cells: patch,
      });
    } catch (error) {
      toast.error(firestoreErrorText(error, "Не удалось сохранить"));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Просьба «поставьте „Успешку“» — единственное, что технарь делает со
   * статусом. Помимо отметки на строке уходит УВЕДОМЛЕНИЕ: раньше чип видел
   * только ОС, открывший карточку именно этой строки на своём столе, а тост
   * обещал «увидит ОС, Тимлид и Owner» — и это была неправда.
   */
  async function askSuccess() {
    setBusy(true);
    try {
      await patchTechOrderRow({
        workspaceId,
        pageId: row.deskPageId || pageId,
        subPageId: row.tabId || subPageId,
        rowId: row.id,
        successRequestedAt: Date.now(),
        successRequestedBy: me,
      });
      const leadership = members
        .filter((m) => m.status === "active" && m.uid && (memberHasRole(m, "owner") || memberHasRole(m, "teamlead")))
        .map((m) => m.uid as string);
      // ОС этого заказа — по uid из строки, а не по нику: ник мог переехать.
      const targets = [...new Set([row.osUid, ...leadership].filter(Boolean) as string[])];
      const deskPage = allPages.find((p) => p.id === (row.deskPageId || pageId));
      const client = clientName(deskPage?.columns);
      await sendNotification(
        {
          workspaceId,
          title: "Просят поставить «Успешку»",
          body: `${myDisplayName(profile, members)}${client ? ` · ${client}` : ""}${deskPage ? ` · ${deskPage.name}` : ""}`,
          priority: "important",
          fromUid: me,
          fromName: myDisplayName(profile, members),
          target: "selected",
          selectedUids: targets,
          pageId: row.deskPageId || pageId || null,
          href: row.deskPageId || pageId ? `/page/${row.deskPageId || pageId}` : null,
          kind: "success-request",
        },
        targets
      ).catch(() => undefined);
      toast.success("Попросили поставить «Успешку»", {
        description: targets.length ? "Уведомление ушло ОС этого заказа и руководству." : "Увидит ОС в карточке заказа.",
      });
    } catch (error) {
      toast.error(firestoreErrorText(error, "Не удалось отправить просьбу"));
    } finally {
      setBusy(false);
    }
  }

  /** Имя клиента из строки — чтобы в уведомлении было видно, о каком заказе речь. */
  function clientName(columns: PageColumn[] | undefined): string {
    if (!columns?.length) return "";
    const picked = pickRowCardColumns(columns);
    return picked.title ? String(row.cells[picked.title.key] ?? "").trim() : "";
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
