import { useMemo, useState } from "react";
import { Building2, Globe, Loader2, Mail } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import { useWorkspace } from "@/hooks/useWorkspace";
import { tenantActive, trialDaysLeft, useTenantInfo } from "@/hooks/useTenantInfo";
import { REGION_PRESETS } from "@/services/companyService";
import { updateWorkspace } from "@/services/workspaceService";
import { isKnownTimeZone } from "@/utils/date";
import { firestoreErrorText } from "@/utils/dbError";
import { seatsState } from "@/utils/seats";
import type { WorkspaceRegion } from "@/types";

const CONTACT = "nurpro2005@gmail.com";
const CUSTOM = "custom";

function zoneList(): string[] {
  try {
    const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
    return intl.supportedValuesOf ? intl.supportedValuesOf("timeZone") : [];
  } catch {
    return [];
  }
}

function fmtDate(ms: number | null): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}

/**
 * «Настройки → Компания» (SaaS этап 3, только Owner): регион компании —
 * часовой пояс и валюта (`workspace.region`; копию в Supabase сверяет мост
 * региона в сессии Owner) — и подписка: тариф, пробный период, места, как
 * связаться с Nova.
 */
export function CompanySettingsPanel() {
  const { activeWorkspace, activeWorkspaceId, members } = useWorkspace();
  const tenant = useTenantInfo(activeWorkspaceId, Boolean(activeWorkspaceId));
  const current = activeWorkspace?.region ?? {};
  const presetOf = (r: WorkspaceRegion) =>
    REGION_PRESETS.find((p) => p.region.timeZone === (r.timeZone || "Asia/Almaty") && p.region.currency === (r.currency || "KZT"))?.id ?? CUSTOM;
  const [presetId, setPresetId] = useState(() => presetOf(current));
  const [timeZone, setTimeZone] = useState(current.timeZone || "Asia/Almaty");
  const [currency, setCurrency] = useState(current.currency || "KZT");
  const [saving, setSaving] = useState(false);
  const zones = useMemo(zoneList, []);
  const seats = seatsState(members, tenant?.seatsLimit ?? null);

  const effective: WorkspaceRegion =
    presetId === CUSTOM
      ? { timeZone: timeZone.trim(), currency: currency.trim().toUpperCase(), locale: current.locale || "ru-KZ" }
      : REGION_PRESETS.find((p) => p.id === presetId)!.region;
  const changed =
    (effective.timeZone || "Asia/Almaty") !== (current.timeZone || "Asia/Almaty") ||
    (effective.currency || "KZT") !== (current.currency || "KZT");
  const valid = Boolean(effective.timeZone && isKnownTimeZone(effective.timeZone) && /^[A-Z]{3}$/.test(effective.currency ?? ""));

  async function save() {
    if (!activeWorkspaceId || !valid || saving) return;
    setSaving(true);
    try {
      await updateWorkspace(activeWorkspaceId, { region: effective });
      toast.success("Регион сохранён", { description: "Даты и суммы у всех пересчитаются после обновления страницы." });
    } catch (error) {
      toast.error(firestoreErrorText(error, "Не удалось сохранить регион"));
    } finally {
      setSaving(false);
    }
  }

  const status = tenant
    ? tenant.status === "suspended"
      ? { label: "Приостановлена", tone: "text-destructive" }
      : tenant.status === "trial"
        ? tenantActive(tenant)
          ? { label: `Пробный период · осталось ${trialDaysLeft(tenant)} дн.`, tone: "text-primary" }
          : { label: "Пробный период закончился", tone: "text-destructive" }
        : { label: tenant.plan === "internal" ? "Активна" : `Активна · тариф ${tenant.plan}`, tone: "text-success" }
    : null;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-primary" /> Регион компании
          </CardTitle>
          <CardDescription>
            По часовому поясу считаются дни, месяцы и периоды столов; валюта — в суммах и итогах. Сейчас:{" "}
            <span className="text-foreground">{current.timeZone || "Asia/Almaty"} · {current.currency || "KZT"}</span>.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="company-region">Страна и валюта</Label>
            <select
              id="company-region"
              value={presetId}
              onChange={(e) => setPresetId(e.target.value)}
              className="h-10 max-w-md rounded-md border border-border bg-background px-3 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {REGION_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
              <option value={CUSTOM}>Другой пояс или валюта…</option>
            </select>
          </div>
          {presetId === CUSTOM ? (
            <div className="grid max-w-md gap-3 sm:grid-cols-[1fr_120px]">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="company-tz">Часовой пояс (IANA)</Label>
                <Input id="company-tz" list="company-tz-list" value={timeZone} onChange={(e) => setTimeZone(e.target.value)} placeholder="Europe/Berlin" />
                {zones.length ? (
                  <datalist id="company-tz-list">
                    {zones.map((z) => (
                      <option key={z} value={z} />
                    ))}
                  </datalist>
                ) : null}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="company-cur">Валюта</Label>
                <Input id="company-cur" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} placeholder="EUR" maxLength={3} className="font-mono uppercase" />
              </div>
            </div>
          ) : null}
          {!valid ? <p className="text-[12px] text-warning">Пояс должен быть известен браузеру, валюта — три латинские буквы.</p> : null}
          <div>
            <Button onClick={() => void save()} disabled={!changed || !valid || saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Сохранить
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-primary" /> Подписка
          </CardTitle>
          <CardDescription>Тариф и места компании ведёт Nova. Изменить их можно через нас.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {tenant ? (
            <dl className="grid gap-x-6 gap-y-2 text-[13px] sm:grid-cols-[160px_1fr]">
              <dt className="text-muted-foreground">Статус</dt>
              <dd className={status?.tone}>{status?.label}</dd>
              {tenant.status === "trial" ? (
                <>
                  <dt className="text-muted-foreground">Пробный до</dt>
                  <dd>{fmtDate(tenant.trialUntil)}</dd>
                </>
              ) : null}
              <dt className="text-muted-foreground">Места</dt>
              <dd>
                {seats.used}
                {seats.limit ? ` из ${seats.limit}` : " · без предела"}
              </dd>
            </dl>
          ) : (
            <Alert tone="info">Сведения о подписке недоступны: компания ещё не в реестре Nova или нет связи с базой.</Alert>
          )}
          <div>
            <Button asChild variant="outline">
              <a href={`mailto:${CONTACT}?subject=${encodeURIComponent(`Nova CRM · ${activeWorkspace?.name ?? "компания"}`)}`}>
                <Mail className="h-4 w-4" /> Написать в Nova
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
