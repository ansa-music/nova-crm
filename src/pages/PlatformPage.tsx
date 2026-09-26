import { useCallback, useEffect, useMemo, useState } from "react";
import { Ban, Building2, Check, Copy, Inbox, Loader2, MoreHorizontal, Plus, RefreshCw, Ticket, X } from "lucide-react";
import { AccessDenied } from "@/components/common/AccessDenied";
import { PageHeader } from "@/components/common/PageHeader";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Section } from "@/components/ui/section";
import { toast } from "@/components/ui/sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/useAuth";
import {
  approveLead,
  companyInviteLink,
  createCompanyInvite,
  listCompanyInvites,
  listLeads,
  listTenants,
  rejectLead,
  revokeCompanyInvite,
  setTenant,
  type CompanyInvite,
  type PlatformLead,
  type Tenant,
  type TenantPatch,
} from "@/services/companyService";
import { getPublicWorkspaceInfo } from "@/services/joinRequestService";
import { isWorkspaceAdmin } from "@/utils/adminAccess";
import { confirmDialog, promptDialog } from "@/utils/appDialog";
import { cn } from "@/utils/cn";
import { firestoreErrorText } from "@/utils/dbError";

/**
 * «Платформа» (`/platform`, SaaS этап 2) — админка продаж, только у
 * администратора платформы (Nurba). Коды приглашения для новых компаний и
 * список компаний с тарифом: пробный период, «оплачено», приостановка,
 * предел мест. Права держит база (Supabase `platform_*` и правило
 * `companyInvites` в Firestore) — страница лишь их вызывает.
 */

const TRIAL_CHOICES = [7, 14, 30, 60];

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" });
}

function daysLeft(iso: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms)) return null;
  return Math.ceil(ms / 86_400_000);
}

function tenantStatusView(t: Tenant): { label: string; tone: string } {
  if (t.status === "suspended") return { label: "Приостановлена", tone: "bg-destructive/12 text-destructive" };
  if (t.status === "active") return { label: t.plan === "internal" ? "Своя" : "Активна", tone: "bg-success/12 text-success" };
  const left = daysLeft(t.trialUntil);
  if (left !== null && left <= 0) return { label: "Пробный кончился", tone: "bg-destructive/12 text-destructive" };
  return {
    label: left === null ? "Пробный" : `Пробный · ${left} дн.`,
    tone: left !== null && left <= 3 ? "bg-warning/15 text-warning" : "bg-primary/12 text-primary",
  };
}

function inviteStatusView(i: CompanyInvite): { label: string; tone: string } {
  if (i.revokedAt) return { label: "Отозван", tone: "bg-muted text-muted-foreground" };
  if (i.usedBy) return { label: `Использован · ${i.workspaceName ?? "компания"}`, tone: "bg-success/12 text-success" };
  return { label: "Свободен", tone: "bg-primary/12 text-primary" };
}

async function copyText(text: string, done: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(done);
  } catch {
    await promptDialog({ title: "Скопируйте вручную", defaultValue: text, confirmLabel: "Готово" });
  }
}

export default function PlatformPage() {
  const { profile } = useAuth();
  const admin = isWorkspaceAdmin(profile?.email);

  const [tenants, setTenants] = useState<Tenant[] | null>(null);
  const [invites, setInvites] = useState<CompanyInvite[] | null>(null);
  const [leads, setLeads] = useState<PlatformLead[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [note, setNote] = useState("");
  const [trialDays, setTrialDays] = useState(14);
  const [seats, setSeats] = useState("");
  const [creating, setCreating] = useState(false);
  const [fresh, setFresh] = useState<CompanyInvite | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [t, i, l] = await Promise.all([listTenants(), listCompanyInvites(), listLeads().catch(() => [] as PlatformLead[])]);
      setTenants(t);
      setInvites(i);
      setLeads(l);
    } catch (error) {
      setLoadError(firestoreErrorText(error, "Не удалось прочитать компании"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (admin) void load();
  }, [admin, load]);

  // Названия компаний — из документа workspace (его читает любой вошедший):
  // у старых компаний в реестре Supabase названия нет.
  useEffect(() => {
    if (!tenants) return;
    const missing = tenants.filter((t) => !names[t.workspaceId]).map((t) => t.workspaceId);
    if (missing.length === 0) return;
    let cancelled = false;
    void Promise.all(missing.map(async (id) => [id, (await getPublicWorkspaceInfo(id))?.name ?? ""] as const)).then((pairs) => {
      if (cancelled) return;
      setNames((prev) => {
        const next = { ...prev };
        for (const [id, name] of pairs) next[id] = name || prev[id] || "";
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
    // names намеренно не в зависимостях — дочитываем только новых.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenants]);

  const sortedTenants = useMemo(
    () => [...(tenants ?? [])].sort((a, b) => (a.plan === "internal" ? -1 : 0) - (b.plan === "internal" ? -1 : 0) || b.createdAt.localeCompare(a.createdAt)),
    [tenants]
  );

  if (!admin) {
    return <AccessDenied reason="Раздел только для администратора платформы Nova." />;
  }

  async function createInvite() {
    if (!profile || creating) return;
    const seatsNum = seats.trim() ? Math.round(Number(seats)) : null;
    if (seatsNum !== null && (!Number.isFinite(seatsNum) || seatsNum < 1 || seatsNum > 1000)) {
      toast.error("Предел мест — от 1 до 1000, или пусто — без предела");
      return;
    }
    setCreating(true);
    try {
      const invite = await createCompanyInvite({ uid: profile.uid, note: note.trim(), trialDays, seatsLimit: seatsNum });
      setFresh(invite);
      setNote("");
      setSeats("");
      await load();
    } catch (error) {
      toast.error(firestoreErrorText(error, "Не удалось создать код"));
    } finally {
      setCreating(false);
    }
  }

  async function revoke(invite: CompanyInvite) {
    const ok = await confirmDialog({
      title: `Отозвать код ${invite.code}?`,
      description: "По нему больше нельзя будет завести компанию.",
      confirmLabel: "Отозвать",
      destructive: true,
    });
    if (!ok) return;
    setBusyId(invite.code);
    try {
      await revokeCompanyInvite(invite.code);
      if (fresh?.code === invite.code) setFresh(null);
      await load();
    } catch (error) {
      toast.error(firestoreErrorText(error, "Не удалось отозвать код"));
    } finally {
      setBusyId(null);
    }
  }

  async function patchTenant(t: Tenant, patch: TenantPatch, done: string) {
    setBusyId(t.workspaceId);
    try {
      await setTenant(t.workspaceId, patch);
      toast.success(done);
      await load();
    } catch (error) {
      toast.error(firestoreErrorText(error, "Не удалось изменить компанию"));
    } finally {
      setBusyId(null);
    }
  }

  function extendTrial(t: Tenant, days: number) {
    const base = Math.max(Date.now(), t.trialUntil ? new Date(t.trialUntil).getTime() : 0);
    const until = new Date(base + days * 86_400_000).toISOString();
    void patchTenant(t, { status: "trial", trialUntil: until }, `Пробный продлён до ${fmtDate(until)}`);
  }

  async function suspend(t: Tenant) {
    const ok = await confirmDialog({
      title: `Приостановить «${names[t.workspaceId] || t.name || t.workspaceId}»?`,
      description: "Сотрудники компании увидят «Доступ приостановлен», данные остаются. Вернуть можно в любой момент.",
      confirmLabel: "Приостановить",
      destructive: true,
    });
    if (ok) void patchTenant(t, { status: "suspended" }, "Компания приостановлена");
  }

  async function editSeats(t: Tenant) {
    const value = await promptDialog({
      title: "Предел мест",
      description: `Сейчас участников: ${t.members}. Пусто — без предела.`,
      defaultValue: t.seatsLimit ? String(t.seatsLimit) : "",
      placeholder: "Например, 15",
      confirmLabel: "Сохранить",
    });
    if (value === null) return;
    const trimmed = value.trim();
    const n = trimmed ? Math.round(Number(trimmed)) : null;
    if (n !== null && (!Number.isFinite(n) || n < 1 || n > 1000)) {
      toast.error("Предел мест — от 1 до 1000");
      return;
    }
    void patchTenant(t, { seatsLimit: n }, n ? `Предел мест: ${n}` : "Предел мест снят");
  }

  /** Одобрить заявку: именной код с текущими «пробный период» и «мест» из формы выше. */
  async function approve(lead: PlatformLead) {
    if (!profile) return;
    const seatsNum = seats.trim() ? Math.round(Number(seats)) : null;
    const ok = await confirmDialog({
      title: `Одобрить «${lead.company}»?`,
      description: `Код на имя ${lead.name || lead.email || "заявителя"}: пробный ${trialDays} дн.${seatsNum ? `, ${seatsNum} мест` : ", без предела мест"}. Человек увидит его на странице подключения.`,
      confirmLabel: "Одобрить",
    });
    if (!ok) return;
    setBusyId(lead.uid);
    try {
      const invite = await approveLead({ uid: lead.uid, adminUid: profile.uid, trialDays, seatsLimit: seatsNum });
      setFresh(invite);
      toast.success(`Код ${invite.code} выдан для «${lead.company}»`);
      await load();
    } catch (error) {
      toast.error(firestoreErrorText(error, "Не удалось одобрить заявку"));
    } finally {
      setBusyId(null);
    }
  }

  async function reject(lead: PlatformLead) {
    const ok = await confirmDialog({
      title: `Отклонить «${lead.company}»?`,
      description: "Человек сможет подать заявку заново.",
      confirmLabel: "Отклонить",
      destructive: true,
    });
    if (!ok) return;
    setBusyId(lead.uid);
    try {
      await rejectLead(lead.uid);
      await load();
    } catch (error) {
      toast.error(firestoreErrorText(error, "Не удалось отклонить заявку"));
    } finally {
      setBusyId(null);
    }
  }

  async function editPlan(t: Tenant) {
    const value = await promptDialog({
      title: "Тариф",
      description: "Короткое имя латиницей: basic, pro, team…",
      defaultValue: t.plan,
      confirmLabel: "Сохранить",
    });
    if (value === null) return;
    const plan = value.trim().toLowerCase();
    if (!/^[a-z][a-z0-9_-]{1,31}$/.test(plan)) {
      toast.error("Тариф — латиница и цифры, от 2 до 32 знаков");
      return;
    }
    void patchTenant(t, { plan }, `Тариф: ${plan}`);
  }

  const freeInvites = (invites ?? []).filter((i) => !i.usedBy && !i.revokedAt).length;

  return (
    <div className="mx-auto w-full min-w-0 max-w-4xl space-y-4 p-4 sm:p-8">
      <PageHeader
        eyebrow="Платформа"
        title="Компании и приглашения"
        description="Кому открыт Nova: коды для новых компаний, пробный период, оплата и предел мест."
        actions={
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Обновить
          </Button>
        }
      />

      {loadError ? (
        <Alert tone="error">
          {/42501/.test(loadError)
            ? "База не узнала в вас администратора платформы: администратор — владелец основной компании Nova. Проверьте, что вошли своим аккаунтом, и обновите страницу."
            : `${loadError}. Если пишет про функцию — обновление базы ещё не накатано, дождитесь деплоя.`}
        </Alert>
      ) : null}

      <Section eyebrow="Новая компания" title="Код приглашения">
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor="invite-note">Для кого</Label>
              <Input
                id="invite-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Название компании или контакт"
                maxLength={200}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Пробный период</Label>
              <div className="flex gap-1">
                {TRIAL_CHOICES.map((d) => (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={trialDays === d}
                    onClick={() => setTrialDays(d)}
                    className={cn(
                      "h-10 min-w-11 rounded-md border px-2 text-[13px]",
                      trialDays === d ? "border-primary/30 bg-primary/12 text-primary" : "border-border text-foreground/80 hover:bg-accent"
                    )}
                  >
                    {d} дн.
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="invite-seats">Мест</Label>
              <Input
                id="invite-seats"
                value={seats}
                onChange={(e) => setSeats(e.target.value.replace(/[^0-9]/g, ""))}
                placeholder="без предела"
                inputMode="numeric"
                className="sm:w-28"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void createInvite()} disabled={creating}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Создать код
            </Button>
            <span className="text-[12px] text-muted-foreground">
              Код одноразовый: по нему заводится ровно одна компания.
            </span>
          </div>
          {fresh ? (
            <div className="flex flex-col gap-2 rounded-lg border border-primary/30 bg-primary/6 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Ticket className="h-4 w-4 text-primary" />
                <span className="font-mono text-lg tracking-widest text-primary">{fresh.code}</span>
                <span className="text-[12px] text-muted-foreground">
                  пробный {fresh.trialDays} дн.{fresh.seatsLimit ? ` · ${fresh.seatsLimit} мест` : ""}
                </span>
              </div>
              <p className="break-all font-mono text-[12px] text-muted-foreground">{companyInviteLink(fresh.code)}</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => void copyText(companyInviteLink(fresh.code), "Ссылка скопирована")}>
                  <Copy className="h-3.5 w-3.5" /> Скопировать ссылку
                </Button>
                <Button size="sm" variant="outline" onClick={() => void copyText(fresh.code, "Код скопирован")}>
                  <Copy className="h-3.5 w-3.5" /> Только код
                </Button>
              </div>
              <p className="text-[12px] text-muted-foreground">
                Отправьте ссылку руководителю компании: он войдёт (Google или почта), введёт название — и станет Owner.
              </p>
            </div>
          ) : null}
        </div>
      </Section>

      {leads && leads.length > 0 ? (
        <Section
          eyebrow="Заявки на подключение"
          title={`Ждут ответа: ${leads.filter((l) => l.status === "pending").length}`}
          padded={false}
        >
          <ul className="divide-y divide-border">
            {leads.map((l) => {
              const busy = busyId === l.uid;
              const view =
                l.status === "pending"
                  ? { label: "Ждёт", tone: "bg-warning/15 text-warning" }
                  : l.status === "approved"
                    ? { label: l.workspaceId ? "Компания заведена" : `Код выдан · ${l.inviteCode ?? ""}`, tone: "bg-success/12 text-success" }
                    : { label: "Отклонена", tone: "bg-muted text-muted-foreground" };
              return (
                <li key={l.uid} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:gap-3">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      <Inbox className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium">{l.company}</p>
                      <p className="truncate text-[12px] text-muted-foreground">
                        {[l.name, l.email, l.contact].filter(Boolean).join(" · ")} · {fmtDate(l.updatedAt)}
                      </p>
                      {l.note ? <p className="mt-1 whitespace-pre-wrap text-[12.5px] text-foreground/80">{l.note}</p> : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <span className={cn("rounded-md px-2 py-1 text-[12px] font-medium", view.tone)}>{view.label}</span>
                    {l.status === "pending" ? (
                      <>
                        <Button size="sm" disabled={busy} onClick={() => void approve(l)}>
                          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Одобрить
                        </Button>
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void reject(l)}>
                          <X className="h-3.5 w-3.5" /> Отклонить
                        </Button>
                      </>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </Section>
      ) : null}

      <Section
        eyebrow="Компании"
        title={tenants ? `${tenants.length} ${tenants.length === 1 ? "компания" : "компаний"}` : "Компании"}
        padded={false}
      >
        {!tenants ? (
          <div className="flex items-center gap-2 p-4 text-[13px] text-muted-foreground">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Загружаю…
          </div>
        ) : sortedTenants.length === 0 ? (
          <p className="p-4 text-[13px] text-muted-foreground">Компаний пока нет.</p>
        ) : (
          <ul className="divide-y divide-border">
            {sortedTenants.map((t) => {
              const status = tenantStatusView(t);
              const name = names[t.workspaceId] || t.name || "Без названия";
              const own = t.plan === "internal";
              const busy = busyId === t.workspaceId;
              return (
                <li key={t.workspaceId} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-3">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      <Building2 className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium">{name}</p>
                      <p className="truncate text-[12px] text-muted-foreground">
                        {t.members}
                        {t.seatsLimit ? ` из ${t.seatsLimit}` : ""} чел. · {t.currency} · с {fmtDate(t.createdAt)}
                        {t.status === "trial" && t.trialUntil ? ` · до ${fmtDate(t.trialUntil)}` : ""}
                        {t.plan !== "internal" && t.plan !== "trial" ? ` · тариф ${t.plan}` : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className={cn("rounded-md px-2 py-1 text-[12px] font-medium", status.tone)}>{status.label}</span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" disabled={busy} aria-label={`Действия с «${name}»`}>
                          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-60">
                        {!own ? (
                          <>
                            <DropdownMenuItem onClick={() => extendTrial(t, 14)}>+14 дней пробного</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => extendTrial(t, 30)}>+30 дней пробного</DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => void patchTenant(t, { status: "active" }, "Компания активна (оплачено)")}
                            >
                              <Check className="h-3.5 w-3.5" /> Оплачено — активна
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => void editPlan(t)}>Тариф…</DropdownMenuItem>
                          </>
                        ) : null}
                        <DropdownMenuItem onClick={() => void editSeats(t)}>Предел мест…</DropdownMenuItem>
                        {!own ? (
                          <>
                            <DropdownMenuSeparator />
                            {t.status === "suspended" ? (
                              <DropdownMenuItem onClick={() => extendTrial(t, 14)}>Вернуть (пробный +14 дней)</DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem className="text-destructive" onClick={() => void suspend(t)}>
                                <Ban className="h-3.5 w-3.5" /> Приостановить
                              </DropdownMenuItem>
                            )}
                          </>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section eyebrow="Приглашения" title={invites ? `Свободных кодов: ${freeInvites}` : "Коды"} padded={false}>
        {!invites ? (
          <div className="p-4 text-[13px] text-muted-foreground">Загружаю…</div>
        ) : invites.length === 0 ? (
          <p className="p-4 text-[13px] text-muted-foreground">Кодов ещё нет — создайте первый выше.</p>
        ) : (
          <ul className="divide-y divide-border">
            {invites.map((i) => {
              const status = inviteStatusView(i);
              const free = !i.usedBy && !i.revokedAt;
              return (
                <li key={i.code} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-[13px] tracking-wider">{i.code}</p>
                    <p className="truncate text-[12px] text-muted-foreground">
                      {i.note || "без пометки"}{i.forUid ? " · именной" : ""} · пробный {i.trialDays} дн.{i.seatsLimit ? ` · ${i.seatsLimit} мест` : ""} · {fmtDate(i.createdAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <span className={cn("max-w-[220px] truncate rounded-md px-2 py-1 text-[12px] font-medium", status.tone)}>
                      {status.label}
                    </span>
                    {free ? (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void copyText(companyInviteLink(i.code), "Ссылка скопирована")}
                        >
                          <Copy className="h-3.5 w-3.5" /> Ссылка
                        </Button>
                        <Button size="sm" variant="ghost" disabled={busyId === i.code} onClick={() => void revoke(i)}>
                          Отозвать
                        </Button>
                      </>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </div>
  );
}
