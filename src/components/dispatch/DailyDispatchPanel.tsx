import { useMemo, useState } from "react";
import { Check, ChevronDown, Link2, PackageCheck, Pencil, Plus, Trash2, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/sonner";
import { useDailyDispatch } from "@/hooks/useDailyDispatch";
import { useDispatchTechnicians } from "@/hooks/useDispatchTechnicians";
import {
  bindDailyDispatchToSheet,
  createDailyDispatch,
  toggleDailyDispatchMark,
} from "@/services/dailyDispatchService";
import {
  bindDispatchTechnician,
  createDispatchTechnician,
  deleteDispatchTechnician,
  renameDispatchTechnician,
} from "@/services/dispatchTechnicianService";
import { displayNameOf } from "@/utils/displayName";
import { formatCurrency } from "@/utils/format";
import { cn } from "@/utils/cn";
import { almatyNoonMillis, USER_TIMEZONE, ymdInTimeZone } from "@/utils/date";
import type { DailyDispatch, DispatchTechnician, StatusOption, WorkspaceMember, WorkspacePage } from "@/types";

interface DailyDispatchPanelProps {
  workspaceId: string;
  uid: string;
  members: WorkspaceMember[];
  pages: WorkspacePage[];
  /** Owner only — binding a roster nickname to a real account, or a dispatch entry to a desk, stays a bigger decision than day-to-day dispatch use. */
  isOwner: boolean;
  /** Shared "Ответственный" list — same one every "Ответственный" column on the site draws from. "ОС" only ever picks from this, never free text. */
  responsibleOptions: StatusOption[];
}

function formatDayHeading(dayKey: string): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  if (!year || !month || !day) return dayKey;
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: USER_TIMEZONE,
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(almatyNoonMillis(year, month - 1, day)));
}

export function DailyDispatchPanel({
  workspaceId,
  uid,
  members,
  pages,
  isOwner,
  responsibleOptions,
}: DailyDispatchPanelProps) {
  const { data: entries, isLoading, reload } = useDailyDispatch(workspaceId, true);
  const { data: technicians, reload: reloadTechnicians } = useDispatchTechnicians(workspaceId, true);
  const [checkNo, setCheckNo] = useState("");
  const [technicianRosterId, setTechnicianRosterId] = useState("");
  const [amount, setAmount] = useState("");
  const [minutes, setMinutes] = useState("");
  const [character, setCharacter] = useState("");
  const [os, setOs] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [pastOpen, setPastOpen] = useState(false);
  const [rosterOpen, setRosterOpen] = useState(false);
  const [bindTarget, setBindTarget] = useState<DailyDispatch | null>(null);

  const todayKey = ymdInTimeZone(Date.now());

  const { today, pastByDay } = useMemo(() => {
    const todayRows = entries.filter((e) => e.dayKey === todayKey);
    const pastRows = entries.filter((e) => e.dayKey !== todayKey);
    const groups = new Map<string, DailyDispatch[]>();
    for (const row of pastRows) {
      const key = row.dayKey || "unknown";
      const list = groups.get(key) ?? [];
      list.push(row);
      groups.set(key, list);
    }
    const pastDays = [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0]));
    return { today: todayRows, pastByDay: pastDays };
  }, [entries, todayKey]);

  async function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;
    const tech = technicians.find((t) => t.id === technicianRosterId);
    if (!tech) {
      toast.error("Выбери технаря из списка ниже");
      return;
    }
    setSubmitting(true);
    try {
      await createDailyDispatch({
        workspaceId,
        checkNo,
        technicianRosterId: tech.id,
        technicianName: tech.nickname,
        technicianUid: tech.memberUid,
        amount: amount.trim() ? Number(amount) : 0,
        minutes: minutes.trim() ? Number(minutes) : null,
        character,
        os,
        createdBy: uid,
      });
      setCheckNo("");
      setTechnicianRosterId("");
      setAmount("");
      setMinutes("");
      setCharacter("");
      setOs("");
      await reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось добавить выдачу");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleMark(row: DailyDispatch, marked: boolean) {
    try {
      await toggleDailyDispatchMark(workspaceId, row.id, uid, marked);
      await reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось отметить");
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3 sm:px-6">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <PackageCheck className="h-3.5 w-3.5" />
        </span>
        <div>
          <h2 className="text-sm font-semibold">Выдача</h2>
          <p className="text-xs text-muted-foreground">Чеки за сегодня — сверху, прошлые дни свёрнуты</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <form
          onSubmit={handleAdd}
          className="mb-6 rounded-md border border-primary/30 bg-primary/5 p-3 sm:p-4"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1 space-y-1.5">
              <Label htmlFor="dispatch-check">Чек</Label>
              <Input
                id="dispatch-check"
                value={checkNo}
                onChange={(e) => setCheckNo(e.target.value)}
                placeholder="Номер чека"
                autoComplete="off"
              />
            </div>
            <div className="min-w-0 flex-[1.2] space-y-1.5">
              <Label>Технар</Label>
              <Select value={technicianRosterId} onValueChange={setTechnicianRosterId}>
                <SelectTrigger>
                  <SelectValue placeholder={technicians.length ? "Выбери технаря" : "Сначала добавь ниже"} />
                </SelectTrigger>
                <SelectContent>
                  {technicians.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.nickname}
                      {!t.memberUid && " · не привязан"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1 space-y-1.5">
              <Label htmlFor="dispatch-amount">Сумма</Label>
              <Input
                id="dispatch-amount"
                type="number"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                autoComplete="off"
              />
            </div>
            <div className="min-w-0 flex-1 space-y-1.5">
              <Label htmlFor="dispatch-minutes">Минуты</Label>
              <Input
                id="dispatch-minutes"
                type="number"
                inputMode="numeric"
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
                placeholder="Длительность видео"
                autoComplete="off"
              />
            </div>
            <div className="min-w-0 flex-[1.4] space-y-1.5">
              <Label htmlFor="dispatch-character">Персонажи</Label>
              <Input
                id="dispatch-character"
                value={character}
                onChange={(e) => setCharacter(e.target.value)}
                placeholder="Кто в видео"
                autoComplete="off"
              />
            </div>
            <div className="min-w-0 flex-1 space-y-1.5">
              <Label>ОС</Label>
              <Select value={os || undefined} onValueChange={setOs}>
                <SelectTrigger>
                  <SelectValue placeholder="Выбери из списка" />
                </SelectTrigger>
                <SelectContent>
                  {responsibleOptions.map((o) => (
                    <SelectItem key={o.value} value={o.label}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" disabled={submitting || !checkNo.trim() || !technicianRosterId} className="shrink-0 gap-1.5">
              <Plus className="h-3.5 w-3.5" /> Добавить
            </Button>
          </div>
        </form>

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-md" />
            ))}
          </div>
        ) : (
          <>
            <section className="space-y-2">
              <h3 className="text-base font-semibold tracking-tight text-primary">
                Сегодня
                <span className="ml-2 text-sm font-normal text-muted-foreground">{formatDayHeading(todayKey)}</span>
              </h3>
              {today.length === 0 ? (
                <p className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                  Сегодня выдач ещё нет
                </p>
              ) : (
                today.map((row) => (
                  <DispatchRow
                    key={row.id}
                    row={row}
                    uid={uid}
                    isOwner={isOwner}
                    onMark={handleMark}
                    onBind={isOwner ? setBindTarget : undefined}
                  />
                ))
              )}
            </section>

            {pastByDay.length > 0 && (
              <section className="mt-8 opacity-70">
                <button
                  type="button"
                  onClick={() => setPastOpen((v) => !v)}
                  className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
                >
                  <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", !pastOpen && "-rotate-90")} />
                  Прошлые дни ({pastByDay.reduce((n, [, rows]) => n + rows.length, 0)})
                </button>
                {pastOpen &&
                  pastByDay.map(([day, rows]) => (
                    <div key={day} className="mb-4 space-y-1.5">
                      <h4 className="text-xs font-medium text-muted-foreground">{formatDayHeading(day)}</h4>
                      {rows.map((row) => (
                        <DispatchRow
                          key={row.id}
                          row={row}
                          uid={uid}
                          isOwner={isOwner}
                          compact
                          onMark={handleMark}
                          onBind={isOwner ? setBindTarget : undefined}
                        />
                      ))}
                    </div>
                  ))}
              </section>
            )}

            <section className="mt-8">
              <button
                type="button"
                onClick={() => setRosterOpen((v) => !v)}
                className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
              >
                <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", !rosterOpen && "-rotate-90")} />
                Технари ({technicians.length})
              </button>
              {rosterOpen && (
                <TechnicianRoster
                  workspaceId={workspaceId}
                  uid={uid}
                  technicians={technicians}
                  members={members}
                  isOwner={isOwner}
                  onChanged={reloadTechnicians}
                />
              )}
            </section>
          </>
        )}
      </div>

      {bindTarget && (
        <BindSheetDialog
          row={bindTarget}
          pages={pages}
          onClose={() => setBindTarget(null)}
          onBound={async () => {
            setBindTarget(null);
            await reload();
          }}
        />
      )}
    </div>
  );
}

function DispatchRow({
  row,
  uid,
  isOwner,
  compact,
  onMark,
  onBind,
}: {
  row: DailyDispatch;
  uid: string;
  isOwner: boolean;
  compact?: boolean;
  onMark: (row: DailyDispatch, marked: boolean) => void;
  onBind?: (row: DailyDispatch) => void;
}) {
  const markedByMe = row.marks[uid] === true;
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-md border border-primary/25 bg-card px-3",
        compact ? "py-2" : "py-3"
      )}
    >
      <div className="min-w-0 flex-1">
        <p className={cn("truncate font-medium", compact ? "text-sm" : "text-base")}>Чек {row.checkNo}</p>
        <p className="truncate text-sm text-muted-foreground">
          {row.technicianName}
          {row.requestStatus === "pending" && <span className="ml-1.5 text-xs text-warning">· ждёт принятия</span>}
          {row.requestStatus === "accepted" && <span className="ml-1.5 text-xs text-success">· принято</span>}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          {row.amount > 0 && <span className="tabular">{formatCurrency(row.amount)}</span>}
          {row.minutes != null && <span>{row.minutes} мин</span>}
          {row.character && <span className="truncate">{row.character}</span>}
          {row.os && <span className="truncate">ОС: {row.os}</span>}
        </div>
        {row.linkedPageName && (
          <p className="truncate text-xs text-primary/80">Лист: {row.linkedPageName}</p>
        )}
      </div>
      <label className="flex shrink-0 cursor-pointer items-center gap-2 text-sm">
        <Checkbox checked={markedByMe} onCheckedChange={(v) => onMark(row, v === true)} />
        <span className={cn(markedByMe ? "text-primary" : "text-muted-foreground")}>отметил</span>
      </label>
      {isOwner && onBind && (
        <Button type="button" variant="outline" size="sm" className="h-8 shrink-0 gap-1.5" onClick={() => onBind(row)}>
          <Link2 className="h-3.5 w-3.5" /> Привязать к листу
        </Button>
      )}
      {markedByMe && <Check className="hidden h-4 w-4 shrink-0 text-primary sm:block" />}
    </div>
  );
}

/**
 * Admin-curated roster — nicknames the shop actually uses, decoupled from
 * whatever email or self-chosen nickname a real account has. Any Admin+
 * (this whole panel is already gated that way) can add/rename a nickname;
 * only Owner can link/relink it to a real account, same weight as binding
 * a dispatch entry to a desk above.
 */
function TechnicianRoster({
  workspaceId,
  uid,
  technicians,
  members,
  isOwner,
  onChanged,
}: {
  workspaceId: string;
  uid: string;
  technicians: DispatchTechnician[];
  members: WorkspaceMember[];
  isOwner: boolean;
  onChanged: () => Promise<void> | void;
}) {
  const [nickname, setNickname] = useState("");
  const [adding, setAdding] = useState(false);
  const activeMembers = useMemo(
    () => members.filter((m) => m.status === "active").sort((a, b) => displayNameOf(a).localeCompare(displayNameOf(b), "ru")),
    [members]
  );

  async function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    if (adding || !nickname.trim()) return;
    setAdding(true);
    try {
      await createDispatchTechnician({ workspaceId, nickname, createdBy: uid });
      setNickname("");
      await onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось добавить технаря");
    } finally {
      setAdding(false);
    }
  }

  async function handleRename(tech: DispatchTechnician) {
    const name = window.prompt("Новый ник", tech.nickname);
    if (!name || !name.trim() || name.trim() === tech.nickname) return;
    try {
      await renameDispatchTechnician(workspaceId, tech.id, name.trim());
      await onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось переименовать");
    }
  }

  async function handleBind(tech: DispatchTechnician, memberUid: string) {
    try {
      await bindDispatchTechnician(workspaceId, tech.id, memberUid || null);
      await onChanged();
      toast.success(memberUid ? "Привязан к аккаунту" : "Отвязан");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось привязать");
    }
  }

  async function handleDelete(tech: DispatchTechnician) {
    if (!window.confirm(`Убрать «${tech.nickname}» из списка технарей?`)) return;
    try {
      await deleteDispatchTechnician(workspaceId, tech.id);
      await onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось удалить");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        Ник придумываешь сам — чтобы не путаться в почте и никах, которые люди сами себе поставили.
        {isOwner ? " Привязка к аккаунту — вручную, ниже." : " Привязку к аккаунту делает Owner."}
      </p>
      {technicians.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          Технарей пока нет — добавь первого ниже
        </p>
      ) : (
        technicians.map((tech) => {
          const bound = tech.memberUid ? activeMembers.find((m) => m.uid === tech.memberUid) : undefined;
          return (
            <div key={tech.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card px-3 py-2">
              <button
                type="button"
                onClick={() => handleRename(tech)}
                className="flex min-w-0 items-center gap-1.5 text-sm font-medium hover:text-primary"
                title="Переименовать"
              >
                <Pencil className="h-3 w-3 shrink-0 text-muted-foreground" />
                <span className="truncate">{tech.nickname}</span>
              </button>
              <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                <UserRound className="h-3 w-3" />
                {bound ? displayNameOf(bound) : "не привязан"}
              </span>
              <div className="flex-1" />
              {isOwner && (
                <Select value={tech.memberUid ?? ""} onValueChange={(v) => handleBind(tech, v)}>
                  <SelectTrigger className="h-8 w-44 shrink-0">
                    <SelectValue placeholder="Привязать к…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Не привязан</SelectItem>
                    {activeMembers.map((m) => (
                      <SelectItem key={m.uid} value={m.uid}>
                        {displayNameOf(m)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <button
                type="button"
                onClick={() => handleDelete(tech)}
                className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-destructive"
                title="Удалить"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })
      )}
      <form onSubmit={handleAdd} className="flex items-end gap-2">
        <div className="min-w-0 flex-1 space-y-1.5">
          <Label htmlFor="tech-nickname">Новый технар</Label>
          <Input
            id="tech-nickname"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="Ник"
            autoComplete="off"
          />
        </div>
        <Button type="submit" variant="outline" disabled={adding || !nickname.trim()} className="shrink-0 gap-1.5">
          <Plus className="h-3.5 w-3.5" /> Добавить
        </Button>
      </form>
    </div>
  );
}

function BindSheetDialog({
  row,
  pages,
  onClose,
  onBound,
}: {
  row: DailyDispatch;
  pages: WorkspacePage[];
  onClose: () => void;
  onBound: () => Promise<void>;
}) {
  const sortedPages = useMemo(() => [...pages].sort((a, b) => a.order - b.order), [pages]);
  const desksForTechnician = useMemo(
    () => (row.technicianUid ? sortedPages.filter((p) => p.responsibleUserId === row.technicianUid) : []),
    [row.technicianUid, sortedPages]
  );
  const [sheetId, setSheetId] = useState(row.linkedPageId ?? desksForTechnician[0]?.id ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    const sheet = sortedPages.find((p) => p.id === sheetId);
    if (!sheet) {
      toast.error("Выберите лист стола");
      return;
    }
    setSaving(true);
    try {
      await bindDailyDispatchToSheet({
        workspaceId: row.workspaceId,
        id: row.id,
        technicianUid: row.technicianUid,
        linkedPageId: sheet.id,
        linkedPageName: sheet.name,
      });
      toast.success(`Привязано к «${sheet.name}»`);
      await onBound();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось привязать");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Привязать к листу</DialogTitle>
          <DialogDescription>
            Чек {row.checkNo} · {row.technicianName}. Связь пишется только в выдачу — строки стола не меняются.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {!row.technicianUid && (
            <p className="text-sm text-muted-foreground">
              «{row.technicianName}» не привязан к аккаунту в разделе «Технари» — можно выбрать любой лист, но заказ никому не придёт как запрос.
            </p>
          )}
          <div className="space-y-1.5">
            <Label>Лист стола</Label>
            <Select value={sheetId || undefined} onValueChange={setSheetId}>
              <SelectTrigger>
                <SelectValue placeholder="Выберите лист" />
              </SelectTrigger>
              <SelectContent>
                {(desksForTechnician.length > 0 ? desksForTechnician : sortedPages).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
                {desksForTechnician.length > 0 &&
                  sortedPages
                    .filter((p) => !desksForTechnician.some((d) => d.id === p.id))
                    .map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={handleSave} disabled={saving || !sheetId}>
            Привязать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
