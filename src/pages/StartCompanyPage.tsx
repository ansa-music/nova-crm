import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Building2, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import { JoinAccountBar } from "@/components/members/JoinAccountBar";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { isWorkspaceAdmin } from "@/utils/adminAccess";
import { firestoreErrorText } from "@/utils/dbError";
import { clearCompanyCode, getCompanyCode, getJoinIntent, rememberCompanyCode } from "@/utils/joinIntent";
import { COLOR_PRESETS } from "@/components/common/ColorPicker";
import {
  CompanyCodeError,
  isCompanyCode,
  normalizeCompanyCode,
  REGION_PRESETS,
  registerCompany,
} from "@/services/companyService";

/**
 * «Регистрация компании» (`/start?code=…`, SaaS этап 2). Сюда ведёт ссылка
 * из приглашения, которое выдаёт администратор платформы: человек входит
 * (или регистрируется), вводит название компании и регион — и становится
 * Owner своей новой компании. Без кода зарегистрировать может только
 * администратор платформы; остальным страница объясняет, где взять код, и
 * ведёт на заявку в существующую компанию.
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
  const [code, setCode] = useState(initialCode);
  const [name, setName] = useState("");
  const [regionId, setRegionId] = useState(REGION_PRESETS[0].id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    // Код из ссылки переживает вход через Google и перезагрузку.
    if (initialCode) rememberCompanyCode(initialCode);
  }, [initialCode]);

  const normalized = normalizeCompanyCode(code);
  const codeOk = isCompanyCode(normalized);
  const canSubmit = Boolean(profile) && name.trim().length >= 2 && (codeOk || (platformAdmin && normalized === ""));
  const region = REGION_PRESETS.find((r) => r.id === regionId)?.region ?? REGION_PRESETS[0].region;

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
      // Даём списку workspace подхватить новый id, как после одобрения заявки.
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
            <h1 className="font-serif text-2xl font-light">Регистрация компании</h1>
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
                className="font-mono uppercase tracking-wider"
              />
              {normalized && !codeOk ? (
                <p className="text-[12px] text-warning">Код — 10 букв и цифр, как в приглашении.</p>
              ) : !normalized && !platformAdmin ? (
                <p className="text-[12px] text-muted-foreground">
                  Код выдаёт Nova при подключении компании. Нет кода — напишите нам.
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="company-name">Название компании</Label>
              <Input
                id="company-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Например, Студия «Мечта»"
                maxLength={80}
              />
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
              <p className="text-[12px] text-muted-foreground">
                По ней считаются дни, месяцы и суммы. Ошиблись — напишите Nova, поменяем.
              </p>
            </div>
            {error ? (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">{error}</p>
            ) : null}
            <Button type="submit" className="min-h-11 sm:min-h-10" disabled={!canSubmit || busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Building2 className="h-4 w-4" />}
              Завести компанию
            </Button>
          </form>
        )}

        <p className="text-center text-[12px] text-muted-foreground">
          Вас пригласили в уже работающую компанию?{" "}
          <Link
            to={joinId ? `/join/${joinId}` : "/"}
            className="text-primary underline-offset-2 hover:underline"
            onClick={() => clearCompanyCode()}
          >
            Подать заявку
          </Link>
        </p>
        <JoinAccountBar email={profile?.email} onBack={goBack} />
      </div>
    </div>
  );
}
