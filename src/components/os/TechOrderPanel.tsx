import { useEffect, useState } from "react";
import { Loader2, Send, Trash2, Undo2, Workflow } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/table/StatusBadge";
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
import {
  DEFAULT_STATUS_OPTIONS,
  ensureApprovalStatus,
  ensureDoneStatus,
  isApprovalOption,
} from "@/utils/columnOptions";
import {
  fetchOrderRequest,
  ORDER_REQUEST_NOTE_MAX,
  orderRequestId,
  submitOrderRequest,
  withdrawOrderRequest,
  type OrderRequest,
  type OrderRequestKind,
} from "@/services/orderRequestService";
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
  const { members, allPages, activeWorkspace } = useWorkspace();
  const { profile } = useAuth();
  /**
   * Запрос к ОС: «удалить заказ» или «поставить статус» — только у заказов,
   * которые ведёт ОС (метка osUid и адрес строки-источника).
   */
  const canRequest = canWrite && Boolean(row.osUid && row.srcPageId && row.srcRowId);
  const deskPageId = row.deskPageId || pageId;
  const requestId = orderRequestId(deskPageId, row.id);
  const [request, setRequest] = useState<OrderRequest | null>(null);
  const [draftKind, setDraftKind] = useState<OrderRequestKind | null>(null);
  const [draftStatus, setDraftStatus] = useState("");
  const [draftNote, setDraftNote] = useState("");
  const statusOptions = ensureApprovalStatus(ensureDoneStatus(activeWorkspace?.statusOptions ?? DEFAULT_STATUS_OPTIONS));
  const requestableStatuses = statusOptions.filter((o) => !isApprovalOption(o) && !o.inactive);

  useEffect(() => {
    if (!canRequest) return;
    let cancelled = false;
    fetchOrderRequest(workspaceId, requestId)
      .then((found) => {
        if (!cancelled) setRequest(found);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [canRequest, workspaceId, requestId]);
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

  async function sendRequest() {
    if (!draftKind || !row.osUid || !row.srcPageId || !row.srcRowId) return;
    if (draftKind === "status" && !draftStatus) {
      toast.error("Выберите статус");
      return;
    }
    setBusy(true);
    try {
      const deskPage = allPages.find((p) => p.id === deskPageId);
      const option = statusOptions.find((o) => o.value === draftStatus);
      const input = {
        kind: draftKind,
        status: draftKind === "status" ? draftStatus : null,
        statusLabel: draftKind === "status" ? (option?.label ?? draftStatus) : null,
        note: draftNote,
        techUid: me,
        techName: myDisplayName(profile, members),
        osUid: row.osUid,
        client: clientName(deskPage?.columns),
        deskPageId,
        deskTabId: row.tabId || subPageId || null,
        rowId: row.id,
        srcPageId: row.srcPageId,
        srcTabId: row.srcTabId || null,
        srcRowId: row.srcRowId,
      };
      await submitOrderRequest(workspaceId, input);
      setRequest({
        ...input,
        id: requestId,
        workspaceId,
        note: draftNote.trim(),
        state: "pending",
        createdAt: Date.now(),
        resolvedAt: null,
        resolvedBy: null,
      });
      setDraftKind(null);
      setDraftNote("");
      setDraftStatus("");
      toast.success("Запрос ушёл ОС", { description: "Он получил уведомление и решит в своём столе." });
    } catch (error) {
      toast.error(firestoreErrorText(error, "Не удалось отправить запрос"));
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    setBusy(true);
    try {
      await withdrawOrderRequest(workspaceId, requestId);
      setRequest(null);
    } catch (error) {
      toast.error(firestoreErrorText(error, "Не удалось отозвать"));
    } finally {
      setBusy(false);
    }
  }

  const pending = request?.state === "pending" ? request : null;
  const requestText = (r: OrderRequest) => (r.kind === "delete" ? "удалить заказ" : `статус «${r.statusLabel ?? r.status}»`);

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
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            className="min-h-9"
            onClick={() => void askSuccess()}
            disabled={busy || requested}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {requested ? "Просьба отправлена" : "Попросить «Успешку»"}
          </Button>
          {canRequest && !pending && !draftKind ? (
            <>
              <Button size="sm" variant="outline" className="min-h-9" disabled={busy} onClick={() => setDraftKind("status")}>
                <Workflow className="h-4 w-4" />
                Попросить статус…
              </Button>
              <Button size="sm" variant="outline" className="min-h-9" disabled={busy} onClick={() => setDraftKind("delete")}>
                <Trash2 className="h-4 w-4" />
                Попросить удалить
              </Button>
            </>
          ) : null}
        </div>
      )}

      {canRequest && pending ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-2.5 py-2 text-xs">
          <span className="font-medium text-warning">Запрос у ОС: {requestText(pending)}</span>
          {pending.note ? <span className="text-muted-foreground">· {pending.note}</span> : null}
          <Button size="sm" variant="ghost" className="ml-auto h-8 gap-1" disabled={busy} onClick={() => void withdraw()}>
            <Undo2 className="h-3.5 w-3.5" /> Отозвать
          </Button>
        </div>
      ) : null}
      {canRequest && request && request.state !== "pending" && !draftKind ? (
        <p className="text-xs text-muted-foreground">
          Прошлый запрос ({requestText(request)}) ОС {request.state === "approved" ? "принял" : "отклонил"}.
        </p>
      ) : null}

      {canRequest && draftKind ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-background/60 p-2.5">
          <span className="text-sm font-medium">
            {draftKind === "delete" ? "Попросить ОС удалить заказ" : "Попросить ОС поставить статус"}
          </span>
          {draftKind === "status" ? (
            <Select value={draftStatus} onValueChange={setDraftStatus}>
              <SelectTrigger className="h-9 w-full sm:w-[220px]">
                <SelectValue placeholder="Какой статус" />
              </SelectTrigger>
              <SelectContent>
                {requestableStatuses.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    <StatusBadge value={o.value} options={statusOptions} />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <Input
            value={draftNote}
            maxLength={ORDER_REQUEST_NOTE_MAX}
            onChange={(e) => setDraftNote(e.target.value)}
            placeholder={draftKind === "delete" ? "Почему удалить (дубль, клиент отказался…)" : "Комментарий для ОС"}
            className="h-9"
          />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" className="min-h-9" disabled={busy} onClick={() => void sendRequest()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Отправить ОС
            </Button>
            <Button size="sm" variant="ghost" className="min-h-9" disabled={busy} onClick={() => setDraftKind(null)}>
              Отмена
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
