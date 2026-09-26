import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Building2, CheckCircle2, Clock, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import { JoinAccountBar } from "@/components/members/JoinAccountBar";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { isWorkspaceAdmin } from "@/utils/adminAccess";
import { cn } from "@/utils/cn";
import { firestoreErrorText } from "@/utils/dbError";
import { clearCompanyCode, getCompanyCode, getJoinIntent, rememberCompanyCode } from "@/utils/joinIntent";
import { COLOR_PRESETS } from "@/components/common/ColorPicker";
import {
  CompanyCodeError,
  fetchMyPlatformStatus,
  isCompanyCode,
  normalizeCompanyCode,
  REGION_PRESETS,
  registerCompany,
  submitLead,
  type MyPlatformStatus,
} from "@/services/companyService";

type Mode = "code" | "lead";

/**
 * «Подключить компанию» (`/start`, SaaS этапы 2–3). Два пути:
 * - есть код приглашения (`?code=…` из ссылки или руками) — название, регион,
 *   «Завести компанию», и человек — Owner новой компании;
 * - кода нет — заявка на подключение (название компании, как связаться).
 *   Администратор одобряет в «Платформе», база выдаёт код НА ИМЯ заявителя,
 *   и эта страница сама показывает «заявка одобрена — заведите компанию».
 * Администратор платформы заводит компанию без кода.
 */
export default function StartCompanyPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { workspaces } = useWorkspace();
  const setActiveWorkspaceId = useWorkspaceStore((s) => s.setActiveWorkspaceId);
  const platformAdmin = isWorkspaceAdmin(profile?.email);

  const initialCode = useMemo(() => {
    const fromUrl = params.get("code");
    if (fromUrl) return normalizeCompanyCode(fromUrl);
    const stored = getCompanyCode();
    return stored && stored !== "-" ? normalizeCompanyCode(stored) : "";
  }, [params]);
  const [mode, setMode] = useState<Mode>(initialCode || platformAdmin ? "code" : "lead");
  const [code, setCode] = useState(initialCode);
  const [name, setName] = useState("");
  const [regionId, setRegionId] = useState(REGION_PRESETS[0].id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // Заявка.
  const [status, setStatus] = useState<MyPlatformStatus | null | undefined>(undefined);
  const [leadCompany, setLeadCompany] = useState("");
  const [leadContact, setLeadContact] = useState("");
  const [leadNote, setLeadNote] = useState("");
  const [leadBusy, setLeadBusy] = useState(false);

  useEffect(() => {
    if (initialCode) rememberCompanyCode(initialCode);
  }, [initialCode]);

  // Своя заявка и код на своё имя — раз при открытии.
  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    fetchMyPlatformStatus()
      .then((s) => {
        if (cancelled) return;
        setStatus(s);
        if (s?.invite && !initialCode) {
          setCode(s.invite.code);
          setMode("code");
          if (s.lead?.company) setName((prev) => prev || s.lead!.company);
        } else if (s?.lead) {
          setLeadCompany(s.lead.company);
          setLeadContact(s.lead.contact);
          setLeadNote(s.lead.note);
          if (!initialCode && !platformAdmin) setMode("lead");
        }
      })
      .catch(() => {
        if (!cancelled) setStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, [profile, initialCode, platformAdmin]);

  const normalized = normalizeCompanyCode(code);
  const codeOk = isCompanyCode(normalized);
  const canSubmit = Boolean(profile) && name.trim().length >= 2 && (codeOk || (platformAdmin && normalized === ""));
  const region = REGION_PRESETS.find((r) => r.id === regionId)?.region ?? REGION_PRESETS[0].region;
  const approvedForMe = Boolean(status?.invite && status.invite.code === normalized);
  const lead = status?.lead ?? null;

  async function submit() {
    if (!profile || !canSubmit || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await registerCompany({
        uid: profile.uid,
        email: profile.email,
        ownerName: profile.name,
        companyName: name,
        icon: "Building2",
        color: COLOR_PRESETS[0],
        code: normalized === "" && platformAdmin ? null : normalized,
        region,
      });
      clearCompanyCode();
      setDone(result.workspace.name);
      if (result.supabase === "failed") {
        toast.warning("Компания заведена, но база строк ещё не подключилась — таблицы пока работают по-старому.");
      }
      setTimeout(() => {
        setActiveWorkspaceId(result.workspace.id);
        navigate("/", { replace: true });
      }, 600);
    } catch (err) {
      const message = err instanceof CompanyCodeError ? err.message : firestoreErrorText(err, "Не удалось завести компанию");
      setError(message);
      toast.error(message);
      setBusy(false);
    }
  }

  async function sendLead() {
    if (!profile || leadBusy) return;
    if (leadCompany.trim().length < 2) {
      toast.error("Напишите название компании");
      return;
    }
    setLeadBusy(true);
    try {
      const saved = await submitLead({
        company: leadCompany,
        contact: leadContact,
        note: leadNote,
        email: profile.email,
        name: profile.name,
      });
      setStatus((prev) => ({ lead: saved, invite: prev?.invite ?? null }));
      toast.success("Заявка отправлена", { description: "Мы свяжемся с вами, а здесь появится кнопка, когда доступ откроют." });
    } catch (err) {
      toast.error(firestoreErrorText(err, "Не удалось отправить заявку"));
    } finally {
      setLeadBusy(false);
    }
  }

  const joinId = getJoinIntent();
  const goBack = workspaces.length > 0 ? () => navigate("/", { replace: true }) : undefined;

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-6">
      <div className="flex w-full max-w-md flex-col gap-5 rounded-xl border border-border bg-card p-6 shadow-sm sm:p-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary/12 text-primary">
            <Building2 className="h-7 w-7" />
          </span>
          <div>
            <p className="eyebrow mb-1 text-primary">Nova CRM</p>
            <h1 className="font-serif text-2xl font-light">Подключить компанию</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Вы станете Owner новой компании: свои столы, сотрудники и данные — отдельно от других компаний.
            </p>
          </div>
        </div>

        {done ? (
          <div className="flex items-center gap-2 rounded-lg bg-success/10 px-4 py-3 text-sm text-success">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            Компания «{done}» заведена — открываем…
          </div>
        ) : (
          <>
            {!platformAdmin ? (
              <div className="flex rounded-md border border-border p-0.5">
                {(
                  [
                    ["lead", "Оставить заявку"],
                    ["code", "У меня есть код"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={mode === value}
                    onClick={() => setMode(value)}
                    className={cn(
                      "min-h-10 flex-1 rounded-sm text-[13px]",
                      mode === value ? "bg-primary/12 text-primary" : "text-foreground/80 hover:bg-accent"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            ) : null}

            {approvedForMe ? (
              <div className="flex items-start gap-2 rounded-lg bg-success/10 px-4 py-3 text-sm text-success">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Ваша заявка одобрена — код уже подставлен. Осталось назвать компанию и выбрать регион.
                  {status?.invite?.trialDays ? ` Пробный период ${status.invite.trialDays} дн.` : ""}
                </span>
              </div>
            ) : null}

            {mode === "code" ? (
              <form
                className="flex flex-col gap-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  void submit();
                }}
              >
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="company-code">Код приглашения</Label>
                  <Input
                    id="company-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder={platformAdmin ? "Можно без кода — вы администратор" : "10 букв и цифр из приглашения"}
                    autoComplete="off"
                    spellCheck={false}
                    readOnly={approvedForMe}
                    className="font-mono uppercase tracking-wider"
                  />
                  {normalized && !codeOk ? (
                    <p className="text-[12px] text-warning">Код — 10 букв и цифр, как в приглашении.</p>
                  ) : !normalized && !platformAdmin ? (
                    <p className="text-[12px] text-muted-foreground">
                      Нет кода?{" "}
                      <button type="button" className="text-primary underline-offset-2 hover:underline" onClick={() => setMode("lead")}>
                        Оставьте заявку
                      </button>{" "}
                      — мы выдадим доступ.
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="company-name">Название компании</Label>
                  <Input id="company-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Например, Студия «Мечта»" maxLength={80} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="company-region">Страна и валюта</Label>
                  <select
                    id="company-region"
                    value={regionId}
                    onChange={(e) => setRegionId(e.target.value)}
                    className="h-10 rounded-md border border-border bg-background px-3 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    {REGION_PRESETS.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-[12px] text-muted-foreground">По ней считаются дни, месяцы и суммы. Поменять можно потом в «Настройки → Компания».</p>
                </div>
                {error ? <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">{error}</p> : null}
                <Button type="submit" className="min-h-11 sm:min-h-10" disabled={!canSubmit || busy}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Building2 className="h-4 w-4" />}
                  Завести компанию
                </Button>
              </form>
            ) : (
              <form
                className="flex flex-col gap-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  void sendLead();
                }}
              >
                {lead?.status === "pending" ? (
                  <div className="flex items-start gap-2 rounded-lg bg-primary/8 px-4 py-3 text-sm text-primary">
                    <Clock className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>Заявка «{lead.company}» отправлена и ждёт ответа. Можно поправить её ниже.</span>
                  </div>
                ) : lead?.status === "rejected" ? (
                  <div className="rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground">
                    Прошлую заявку не одобрили. Можно подать заново — напишите подробнее, чем занимается компания.
                  </div>
                ) : status === undefined ? (
                  <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Проверяю, нет ли уже заявки…
                  </div>
                ) : null}
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="lead-company">Название компании</Label>
                  <Input id="lead-company" value={leadCompany} onChange={(e) => setLeadCompany(e.target.value)} placeholder="Студия «Мечта»" maxLength={120} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="lead-contact">Как с вами связаться</Label>
                  <Input id="lead-contact" value={leadContact} onChange={(e) => setLeadContact(e.target.value)} placeholder="Telegram, WhatsApp или телефон" maxLength={200} />
                  <p className="text-[12px] text-muted-foreground">Почта {profile?.email} уже в заявке.</p>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="lead-note">Пара слов о команде</Label>
                  <Textarea
                    id="lead-note"
                    value={leadNote}
                    onChange={(e) => setLeadNote(e.target.value)}
                    placeholder="Сколько человек, чем занимаетесь, что сейчас используете"
                    maxLength={1000}
                    rows={3}
                  />
                </div>
                <Button type="submit" className="min-h-11 sm:min-h-10" disabled={leadBusy || leadCompany.trim().length < 2}>
                  {leadBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {lead?.status === "pending" ? "Обновить заявку" : "Отправить заявку"}
                </Button>
              </form>
            )}
          </>
        )}

        <p className="text-center text-[12px] text-muted-foreground">
          Вас пригласили в уже работающую компанию?{" "}
          <Link to={joinId ? `/join/${joinId}` : "/"} className="text-primary underline-offset-2 hover:underline" onClick={() => clearCompanyCode()}>
            Подать заявку
          </Link>
        </p>
        <JoinAccountBar email={profile?.email} onBack={goBack} />
      </div>
    </div>
  );
}
