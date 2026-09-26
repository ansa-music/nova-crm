import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Download, Eye, EyeOff, ImagePlus, Loader2, Plus, RotateCcw, Trash2, Upload, Wand2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/sonner";
import { BrandMark } from "@/components/common/BrandMark";
import { useWorkspace } from "@/hooks/useWorkspace";
import { setSiteDraft, term } from "@/config/siteTerms";
import { removeBrandLogo, uploadBrandLogo } from "@/services/brandService";
import { updateSiteConfig } from "@/services/workspaceService";
import { firestoreErrorText } from "@/utils/dbError";
import { cn } from "@/utils/cn";
import { ALL_ROLES, ROLE_LABELS, type ColumnType, type Role } from "@/types";
import {
  HOME_TARGETS,
  LOCKED_NAV_KEYS,
  MODULES,
  PRIMARY_PRESETS,
  SITE_BACKGROUNDS,
  TERM_META,
  isModuleEnabled,
  sanitizeSiteConfig,
  siteConfigOf,
  type SiteConfig,
  type SiteDeskTemplate,
  type TermKey,
} from "@/types/siteConfig";

/**
 * «Настройки → Конструктор» (только Owner; просьба Nurba 26.09.2026:
 * «возможность полной реконструкции сайта под другую компанию — изменить
 * любую часть сайта»). Всё, что здесь меняется, сразу видно на своём экране
 * (предпросмотр через `setSiteDraft`), а в базу уходит по «Сохранить» — одной
 * записью `workspace.site`. Пустая настройка — сайт Nova как был.
 */

const NOVA: SiteConfig = {};

/** Пункты меню, которые Owner вправе переименовать, скрыть и переставить. */
const NAV_CATALOG: Array<{ key: string; section: "main" | "more"; label: () => string }> = [
  { key: "home", section: "main", label: () => "Главная" },
  { key: "orders", section: "main", label: () => term("order", "many", NOVA) },
  { key: "os-desk", section: "main", label: () => term("osDesk", "one", NOVA) },
  { key: "desks", section: "main", label: () => term("desk", "many", NOVA) },
  { key: "technicians", section: "main", label: () => term("technician", "many", NOVA) },
  { key: "os-desks", section: "main", label: () => term("osDesk", "many", NOVA) },
  { key: "telegram", section: "main", label: () => "Telegram" },
  { key: "grok", section: "main", label: () => term("grok", "one", NOVA) },
  { key: "chat", section: "main", label: () => "Чат" },
  { key: "schedule", section: "main", label: () => "График" },
  { key: "dashboard", section: "main", label: () => "Дашборд · ABS" },
  { key: "more-page", section: "main", label: () => "Ещё" },
  { key: "reports", section: "more", label: () => "Отчёты" },
  { key: "os-dispatch", section: "more", label: () => "Выдачи ОС" },
  { key: "desk-editing", section: "more", label: () => "Правка столов" },
  { key: "people", section: "more", label: () => "Люди" },
  { key: "team", section: "more", label: () => "Команда" },
  { key: "users", section: "more", label: () => "Пользователи" },
  { key: "announcements", section: "more", label: () => "Объявления" },
  { key: "settings", section: "more", label: () => "Настройки" },
];

const COLUMN_TYPES: Array<{ value: ColumnType; label: string }> = [
  { value: "text", label: "Текст" },
  { value: "number", label: "Число" },
  { value: "currency", label: "Деньги" },
  { value: "status", label: "Статус" },
  { value: "responsible", label: "Ответственный (ОС)" },
  { value: "technician", label: "Исполнитель" },
  { value: "date", label: "Дата" },
  { value: "phone", label: "Телефон" },
  { value: "email", label: "Почта" },
  { value: "url", label: "Ссылка" },
];

const NOVA_DESK_COLUMNS: SiteDeskTemplate["columns"] = [
  { key: "name", label: "Название", type: "text", width: 220 },
  { key: "number", label: "Номер", type: "text", width: 140 },
  { key: "status", label: "Статус", type: "status", width: 150 },
  { key: "price", label: "Цена", type: "currency", width: 140 },
  { key: "responsible", label: "ОС", type: "responsible", width: 160 },
];

// ---------------------------------------------------------------------
// Цвет: #hex ↔ «H S% L%».
// ---------------------------------------------------------------------

function hexToHsl(hex: string): string | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

function hslToHex(hsl: string): string {
  const m = /^(\d+(?:\.\d+)?) (\d+(?:\.\d+)?)% (\d+(?:\.\d+)?)%$/.exec(hsl.trim());
  if (!m) return "#7fd6e6";
  const h = Number(m[1]) / 360;
  const s = Number(m[2]) / 100;
  const l = Number(m[3]) / 100;
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// ---------------------------------------------------------------------

function Section({ title, description, children, onReset }: { title: string; description: string; children: ReactNode; onReset?: () => void }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="min-w-0">
          <CardTitle className="text-base">{title}</CardTitle>
          <CardDescription className="mt-1">{description}</CardDescription>
        </div>
        {onReset ? (
          <Button type="button" variant="ghost" size="sm" className="shrink-0 text-muted-foreground" onClick={onReset}>
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            Как у Nova
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">{children}</CardContent>
    </Card>
  );
}

export function SiteBuilderPanel() {
  const { activeWorkspace, activeWorkspaceId } = useWorkspace();
  const saved = useMemo(() => sanitizeSiteConfig(siteConfigOf(activeWorkspace)), [activeWorkspace]);
  const savedKey = JSON.stringify(saved);
  const [draft, setDraft] = useState<SiteConfig>(saved);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [importText, setImportText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  // Логотипы, загруженные в этом сеансе и так и не сохранённые, — убрать при уходе.
  const uploadedRef = useRef<string[]>([]);

  const clean = useMemo(() => sanitizeSiteConfig(draft), [draft]);
  const cleanKey = JSON.stringify(clean);
  const changed = cleanKey !== savedKey;

  // Пришло с сервера (другая вкладка сохранила) — черновик подхватывает,
  // если человек здесь ничего не менял.
  const lastSavedRef = useRef(savedKey);
  useEffect(() => {
    setDraft((prev) => (JSON.stringify(sanitizeSiteConfig(prev)) === lastSavedRef.current ? JSON.parse(savedKey) : prev));
    lastSavedRef.current = savedKey;
  }, [savedKey]);

  // Предпросмотр: черновик сразу виден на своём экране.
  useEffect(() => {
    setSiteDraft(changed ? JSON.parse(cleanKey) : null);
  }, [cleanKey, changed]);
  useEffect(
    () => () => {
      setSiteDraft(null);
      const saveds = uploadedRef.current;
      if (saveds.length) void Promise.all(saveds.map((p) => removeBrandLogo(p))).catch(() => undefined);
    },
    []
  );

  function patch(update: (prev: SiteConfig) => SiteConfig) {
    setDraft((prev) => update(prev));
  }

  async function save() {
    if (!activeWorkspaceId || saving) return;
    setSaving(true);
    try {
      const previousLogo = saved.brand?.logoPath;
      await updateSiteConfig(activeWorkspaceId, clean);
      const nextLogo = clean.brand?.logoPath;
      uploadedRef.current = uploadedRef.current.filter((p) => p !== nextLogo);
      if (previousLogo && previousLogo !== nextLogo) void removeBrandLogo(previousLogo).catch(() => undefined);
      toast.success("Сайт сохранён — у всех обновится сам");
    } catch (error) {
      toast.error(firestoreErrorText(error, "Не удалось сохранить"));
    } finally {
      setSaving(false);
    }
  }

  async function onLogo(file: File | undefined) {
    if (!file || !activeWorkspaceId) return;
    setUploading(true);
    try {
      const { url, path } = await uploadBrandLogo(activeWorkspaceId, file);
      uploadedRef.current.push(path);
      patch((prev) => ({ ...prev, brand: { ...prev.brand, logoUrl: url, logoPath: path } }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось загрузить логотип");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function exportJson() {
    const data = JSON.stringify(clean, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `site-${activeWorkspace?.name ?? "company"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function importJson() {
    try {
      const parsed = sanitizeSiteConfig(JSON.parse(importText));
      setDraft(parsed);
      setImportText("");
      toast.success("Настройка загружена — проверьте и нажмите «Сохранить»");
    } catch {
      toast.error("Это не похоже на файл настройки сайта");
    }
  }

  // ---- Меню: порядок по секциям ----
  const order = useMemo(() => {
    const own = clean.nav?.order ?? [];
    const rank = (key: string, i: number) => {
      const at = own.indexOf(key);
      return at < 0 ? own.length + i : at;
    };
    return NAV_CATALOG.map((item, i) => ({ item, r: rank(item.key, i) }))
      .sort((a, b) => a.r - b.r)
      .map((x) => x.item);
  }, [clean.nav?.order]);

  function move(key: string, dir: -1 | 1) {
    const section = NAV_CATALOG.find((i) => i.key === key)?.section;
    const list = order.map((i) => i.key);
    const same = order.filter((i) => i.section === section).map((i) => i.key);
    const at = same.indexOf(key);
    const swapWith = same[at + dir];
    if (!swapWith) return;
    const a = list.indexOf(key);
    const b = list.indexOf(swapWith);
    [list[a], list[b]] = [list[b], list[a]];
    patch((prev) => ({ ...prev, nav: { ...prev.nav, order: list } }));
  }

  const hidden = new Set(clean.nav?.hidden ?? []);
  const primary = clean.theme?.primary ?? PRIMARY_PRESETS[0].hsl;
  const columns = clean.deskTemplate?.columns ?? null;

  function setColumns(next: SiteDeskTemplate["columns"] | null) {
    patch((prev) => ({ ...prev, deskTemplate: next ? { columns: next } : undefined }));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="sticky top-0 z-10 -mx-1 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background/95 px-3 py-2 backdrop-blur">
        <Wand2 className="h-4 w-4 text-primary" />
        <div className="min-w-0 flex-1 text-[13px]">
          <div className="font-medium">Конструктор сайта</div>
          <div className="text-muted-foreground">
            {changed ? "Предпросмотр: изменения видны только вам, пока не сохраните" : "Всё сохранено. Меняйте — сразу увидите на экране"}
          </div>
        </div>
        <Button type="button" variant="outline" size="sm" disabled={!changed || saving} onClick={() => setDraft(saved)}>
          Отменить
        </Button>
        <Button type="button" size="sm" disabled={!changed || saving} onClick={save}>
          {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
          Сохранить
        </Button>
      </div>

      <Section
        title="Бренд"
        description="Название и логотип в меню, во вкладке браузера, на экране входа и загрузки."
        onReset={clean.brand ? () => patch((prev) => ({ ...prev, brand: undefined })) : undefined}
      >
        <div className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-3">
          <BrandMark />
          <span className="ml-auto text-[12px] text-muted-foreground">так видно в меню</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
          <label className="flex flex-col gap-1 text-[13px]">
            Название компании
            <Input
              value={draft.brand?.name ?? ""}
              maxLength={40}
              placeholder="Nova"
              onChange={(e) => patch((prev) => ({ ...prev, brand: { ...prev.brand, name: e.target.value } }))}
            />
          </label>
          <label className="flex flex-col gap-1 text-[13px]">
            Знак (1–3)
            <Input
              value={draft.brand?.mark ?? ""}
              maxLength={3}
              placeholder="N"
              onChange={(e) => patch((prev) => ({ ...prev, brand: { ...prev.brand, mark: e.target.value } }))}
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            className="hidden"
            onChange={(e) => void onLogo(e.target.files?.[0])}
          />
          <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
            {uploading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <ImagePlus className="mr-1.5 h-4 w-4" />}
            {clean.brand?.logoUrl ? "Заменить логотип" : "Загрузить логотип"}
          </Button>
          {clean.brand?.logoUrl ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => patch((prev) => ({ ...prev, brand: { ...prev.brand, logoUrl: undefined, logoPath: undefined } }))}
            >
              <X className="mr-1.5 h-4 w-4" />
              Убрать логотип
            </Button>
          ) : null}
          <span className="text-[12px] text-muted-foreground">PNG, JPG, WEBP или SVG до 512 КБ, лучше квадратный</span>
        </div>
      </Section>

      <Section
        title="Цвета"
        description="Главный цвет — кнопки, ссылки, активный пункт меню. Фон — оттенок всех поверхностей."
        onReset={clean.theme ? () => patch((prev) => ({ ...prev, theme: undefined })) : undefined}
      >
        <div className="flex flex-wrap items-center gap-2">
          {PRIMARY_PRESETS.map((p) => (
            <button
              key={p.hsl}
              type="button"
              title={p.title}
              aria-label={p.title}
              aria-pressed={primary === p.hsl}
              onClick={() => patch((prev) => ({ ...prev, theme: { ...prev.theme, primary: p.hsl === PRIMARY_PRESETS[0].hsl ? undefined : p.hsl } }))}
              className={cn(
                "h-9 w-9 rounded-full border-2 transition",
                primary === p.hsl ? "border-foreground" : "border-transparent hover:border-border"
              )}
              style={{ background: `hsl(${p.hsl})` }}
            />
          ))}
          <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
            свой
            <input
              type="color"
              value={hslToHex(primary)}
              onChange={(e) => {
                const hsl = hexToHsl(e.target.value);
                if (hsl) patch((prev) => ({ ...prev, theme: { ...prev.theme, primary: hsl } }));
              }}
              className="h-9 w-12 cursor-pointer rounded border border-border bg-transparent"
            />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          {SITE_BACKGROUNDS.map((bg) => {
            const active = (clean.theme?.background ?? "graphite") === bg.key;
            return (
              <button
                key={bg.key}
                type="button"
                aria-pressed={active}
                onClick={() => patch((prev) => ({ ...prev, theme: { ...prev.theme, background: bg.key === "graphite" ? undefined : bg.key } }))}
                className={cn(
                  "rounded-md border px-3 py-1.5 text-[13px]",
                  active ? "border-primary/40 bg-primary/12 text-primary" : "border-border hover:bg-accent"
                )}
              >
                {bg.title}
              </button>
            );
          })}
        </div>
      </Section>

      <Section
        title="Слова"
        description="Как называются вещи на вашем сайте. Пусто — как у Nova. Меняет меню, заголовки разделов и роли."
        onReset={clean.terms ? () => patch((prev) => ({ ...prev, terms: undefined })) : undefined}
      >
        <div className="grid gap-2">
          {TERM_META.map((meta) => (
            <div key={meta.key} className="grid items-center gap-2 sm:grid-cols-[180px_1fr_1fr]">
              <div className="min-w-0 text-[13px]">
                <div className="font-medium">{meta.title}</div>
                {meta.hint ? <div className="text-[11px] text-muted-foreground">{meta.hint}</div> : null}
              </div>
              <Input
                aria-label={`${meta.title}: один`}
                value={draft.terms?.[meta.key]?.one ?? ""}
                maxLength={32}
                placeholder={meta.defaults.one}
                onChange={(e) => setTerm(meta.key, "one", e.target.value)}
              />
              {meta.single ? (
                <div className="hidden sm:block" />
              ) : (
                <Input
                  aria-label={`${meta.title}: много`}
                  value={draft.terms?.[meta.key]?.many ?? ""}
                  maxLength={32}
                  placeholder={meta.defaults.many}
                  onChange={(e) => setTerm(meta.key, "many", e.target.value)}
                />
              )}
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Роли"
        description="Подписи ролей в списке людей, заявках и меню аккаунта. Права ролей не меняются."
        onReset={clean.roles ? () => patch((prev) => ({ ...prev, roles: undefined })) : undefined}
      >
        <div className="grid gap-2 sm:grid-cols-2">
          {ALL_ROLES.map((role) => (
            <label key={role} className="flex flex-col gap-1 text-[13px]">
              <span className="text-muted-foreground">{ROLE_LABELS[role]}</span>
              <Input
                value={draft.roles?.[role] ?? ""}
                maxLength={24}
                placeholder={defaultRoleLabel(role, clean)}
                onChange={(e) => patch((prev) => ({ ...prev, roles: { ...prev.roles, [role]: e.target.value } }))}
              />
            </label>
          ))}
        </div>
      </Section>

      <Section
        title="Разделы"
        description="Выключенный раздел исчезает из меню у всех и не открывается по ссылке. Данные не удаляются — включите обратно, и всё на месте."
        onReset={clean.modules ? () => patch((prev) => ({ ...prev, modules: undefined })) : undefined}
      >
        <div className="grid gap-2 sm:grid-cols-2">
          {MODULES.map((m) => {
            const on = isModuleEnabled(clean, m.key);
            return (
              <label
                key={m.key}
                className="flex cursor-pointer items-start gap-3 rounded-md border border-border px-3 py-2.5 hover:bg-accent/40"
              >
                <Switch
                  checked={on}
                  onCheckedChange={(next) =>
                    patch((prev) => ({ ...prev, modules: { ...prev.modules, [m.key]: next ? undefined : false } }))
                  }
                />
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium">{m.title}</span>
                  <span className="block text-[11px] text-muted-foreground">{m.hint}</span>
                </span>
              </label>
            );
          })}
        </div>
      </Section>

      <Section
        title="Меню"
        description="Свои подписи пунктов, скрыть лишнее, поменять порядок. «Главная», «Ещё» и «Настройки» не скрываются."
        onReset={
          clean.nav?.labels || clean.nav?.hidden || clean.nav?.order
            ? () => patch((prev) => ({ ...prev, nav: prev.nav?.home ? { home: prev.nav.home } : undefined }))
            : undefined
        }
      >
        {(["main", "more"] as const).map((section) => (
          <div key={section} className="flex flex-col gap-1.5">
            <div className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">
              {section === "main" ? "Главное меню" : "Страница «Ещё»"}
            </div>
            {order
              .filter((item) => item.section === section)
              .map((item, index, list) => {
                const locked = LOCKED_NAV_KEYS.includes(item.key);
                const isHidden = hidden.has(item.key);
                return (
                  <div key={item.key} className={cn("flex items-center gap-1.5", isHidden && "opacity-50")}>
                    <Input
                      className="h-9 min-w-0 flex-1"
                      value={draft.nav?.labels?.[item.key] ?? ""}
                      maxLength={32}
                      placeholder={item.label()}
                      aria-label={`Подпись пункта «${item.label()}»`}
                      onChange={(e) =>
                        patch((prev) => ({ ...prev, nav: { ...prev.nav, labels: { ...prev.nav?.labels, [item.key]: e.target.value } } }))
                      }
                    />
                    <Button type="button" variant="ghost" size="icon" data-compact className="h-9 w-9" disabled={index === 0} onClick={() => move(item.key, -1)} aria-label="Выше">
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      data-compact
                      className="h-9 w-9"
                      disabled={index === list.length - 1}
                      onClick={() => move(item.key, 1)}
                      aria-label="Ниже"
                    >
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      data-compact
                      className="h-9 w-9"
                      disabled={locked}
                      aria-pressed={isHidden}
                      aria-label={isHidden ? "Показать" : "Скрыть"}
                      title={locked ? "Этот пункт не скрывается" : isHidden ? "Показать" : "Скрыть"}
                      onClick={() =>
                        patch((prev) => {
                          const set = new Set(prev.nav?.hidden ?? []);
                          if (set.has(item.key)) set.delete(item.key);
                          else set.add(item.key);
                          return { ...prev, nav: { ...prev.nav, hidden: [...set] } };
                        })
                      }
                    >
                      {isHidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                );
              })}
          </div>
        ))}
      </Section>

      <Section
        title="Главная страница"
        description="Куда попадает человек, когда открывает сайт. Если раздела у роли нет — прежняя главная."
        onReset={clean.nav?.home ? () => patch((prev) => ({ ...prev, nav: { ...prev.nav, home: undefined } })) : undefined}
      >
        <div className="grid gap-2 sm:grid-cols-2">
          {ALL_ROLES.map((role) => (
            <label key={role} className="flex flex-col gap-1 text-[13px]">
              <span className="text-muted-foreground">{defaultRoleLabel(role, clean)}</span>
              <Select
                value={clean.nav?.home?.[role] ?? "auto"}
                onValueChange={(value) =>
                  patch((prev) => ({ ...prev, nav: { ...prev.nav, home: { ...prev.nav?.home, [role]: value === "auto" ? undefined : value } } }))
                }
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Как сейчас (автоматически)</SelectItem>
                  {HOME_TARGETS.filter((t) => !t.module || isModuleEnabled(clean, t.module)).map((t) => (
                    <SelectItem key={t.path} value={t.path}>
                      {t.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          ))}
        </div>
      </Section>

      <Section
        title="Шаблон нового стола"
        description="Столбцы, с которыми создаётся новый стол. Уже созданные столы не меняются. Варианты статусов — в «Списках»."
        onReset={columns ? () => setColumns(null) : undefined}
      >
        {columns ? (
          <div className="flex flex-col gap-1.5">
            {columns.map((col, index) => (
              <div key={`${col.key}-${index}`} className="grid grid-cols-[1fr_auto] items-center gap-1.5 sm:grid-cols-[1fr_170px_80px_auto]">
                <Input
                  className="h-9"
                  value={col.label}
                  maxLength={40}
                  aria-label="Название столбца"
                  onChange={(e) => setColumns(columns.map((c, i) => (i === index ? { ...c, label: e.target.value } : c)))}
                />
                <div className="col-span-2 row-start-2 sm:col-span-1 sm:row-start-auto">
                  <Select
                    value={col.type}
                    onValueChange={(value) => setColumns(columns.map((c, i) => (i === index ? { ...c, type: value as ColumnType } : c)))}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {COLUMN_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Input
                  className="hidden h-9 sm:block"
                  type="number"
                  min={60}
                  max={600}
                  value={col.width}
                  aria-label="Ширина"
                  onChange={(e) => setColumns(columns.map((c, i) => (i === index ? { ...c, width: Number(e.target.value) || 150 } : c)))}
                />
                <div className="flex items-center">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    data-compact
                    className="h-9 w-9"
                    disabled={index === 0}
                    aria-label="Выше"
                    onClick={() => {
                      const next = [...columns];
                      [next[index - 1], next[index]] = [next[index], next[index - 1]];
                      setColumns(next);
                    }}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    data-compact
                    className="h-9 w-9"
                    aria-label="Убрать столбец"
                    onClick={() => setColumns(columns.length > 1 ? columns.filter((_, i) => i !== index) : null)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              disabled={columns.length >= 30}
              onClick={() => setColumns([...columns, { key: `col${Date.now().toString(36)}`, label: "Новый столбец", type: "text", width: 150 }])}
            >
              <Plus className="mr-1.5 h-4 w-4" />
              Столбец
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
            Сейчас — столбцы Nova: {NOVA_DESK_COLUMNS.map((c) => c.label).join(", ")}.
            <Button type="button" variant="outline" size="sm" onClick={() => setColumns(NOVA_DESK_COLUMNS.map((c) => ({ ...c })))}>
              Настроить свои
            </Button>
          </div>
        )}
      </Section>

      <Section title="Перенос настройки" description="Скачайте настройку и загрузите её в другой компании — сайт соберётся таким же. Логотип переносится ссылкой.">
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={exportJson}>
            <Download className="mr-1.5 h-4 w-4" />
            Скачать настройку
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!Object.keys(clean).length}
            onClick={() => setDraft({})}
          >
            <RotateCcw className="mr-1.5 h-4 w-4" />
            Всё как у Nova
          </Button>
        </div>
        <Textarea
          value={importText}
          rows={3}
          placeholder="Вставьте сюда содержимое файла настройки"
          onChange={(e) => setImportText(e.target.value)}
        />
        <Button type="button" variant="outline" size="sm" className="self-start" disabled={!importText.trim()} onClick={importJson}>
          <Upload className="mr-1.5 h-4 w-4" />
          Загрузить в черновик
        </Button>
      </Section>
    </div>
  );

  function setTerm(key: TermKey, form: "one" | "many", value: string) {
    patch((prev) => ({ ...prev, terms: { ...prev.terms, [key]: { ...prev.terms?.[key], [form]: value } } }));
  }
}

function defaultRoleLabel(role: Role, config: SiteConfig): string {
  if (config.roles?.[role]) return config.roles[role] as string;
  if (role === "manager" && config.terms?.technician?.one) return config.terms.technician.one;
  if (role === "os" && config.terms?.os?.one) return config.terms.os.one;
  return ROLE_LABELS[role];
}
