import { useMemo, useState } from "react";
import { EyeOff, Loader2, Plus, Settings2, Trash2, UserCog, Users, Clock } from "lucide-react";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { ShiftField } from "@/components/schedule/ShiftField";
import { initialsName, type ScheduleRow } from "@/components/schedule/ScheduleGrid";
import { updateScheduleSettings } from "@/services/workspaceService";
import { firestoreErrorText } from "@/utils/dbError";
import { cn } from "@/utils/cn";
import { matchesPersonQuery } from "@/utils/weekTemplate";
import { personLabel } from "@/utils/peopleDesks";
import {
  ROLE_LABELS,
  SCHEDULE_EDITORS_LIMIT,
  SCHEDULE_PRESETS_LIMIT,
  scheduleSettingsOf,
  type ScheduleHours,
  type ScheduleSettings,
  type ScheduleShiftPreset,
  type WorkspaceMember,
} from "@/types";

type PresetDraft = { key: string; name: string; hours: ScheduleHours | null };

let presetSeq = 0;
const presetKey = () => `p${(presetSeq += 1)}`;

/**
 * «Настройка графика» — только Owner (просьба Nurba: «дай Owner особое
 * редактирование как настройку»). Всё живёт в `workspace.scheduleSettings`:
 *
 * - кто ЕЩЁ правит график, кроме Owner и Тимлида (старший ОС, админ смены) —
 *   право держат правила (`isScheduleEditor`), а не только интерфейс;
 * - смены команды — первые кнопки у каждого поля смены;
 * - норма на смене — меньше людей в день, и число «На смене» красное;
 * - кого не показывать в графике (Owner без смен и т.п.).
 */
export function ScheduleSettingsDialog({
  workspaceId,
  settings,
  members,
  people,
  onClose,
}: {
  workspaceId: string;
  settings: ScheduleSettings | null | undefined;
  /** Активные участники — кому можно дать право правки. */
  members: WorkspaceMember[];
  /** Все строки графика, включая скрытые, — для «Не показывать». */
  people: ScheduleRow[];
  onClose: () => void;
}) {
  const initial = useMemo(() => scheduleSettingsOf({ scheduleSettings: settings ?? undefined }), [settings]);
  const [editors, setEditors] = useState<Set<string>>(() => new Set(initial.editors));
  const [presets, setPresets] = useState<PresetDraft[]>(() =>
    initial.presets.map((p) => ({ key: presetKey(), name: p.name ?? "", hours: { from: p.from, to: p.to, ...(p.label ? { label: p.label } : {}) } }))
  );
  const [minTech, setMinTech] = useState(initial.minOnShift.tech ? String(initial.minOnShift.tech) : "");
  const [minOs, setMinOs] = useState(initial.minOnShift.os ? String(initial.minOnShift.os) : "");
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(initial.hidden));
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);

  // Owner и Тимлид правят график всегда — в списке их нет, чтобы не казалось,
  // что право можно у них снять.
  const candidates = useMemo(
    () =>
      members
        .filter((m) => m.role !== "owner" && m.role !== "teamlead")
        .filter((m) => matchesPersonQuery(query, [personLabel(m), m.name, m.nickname, m.email]))
        .sort((a, b) => personLabel(a).localeCompare(personLabel(b), "ru")),
    [members, query]
  );
  // Кто в списке, но уже не участник — показываем, чтобы было видно и можно снять.
  const staleEditors = [...editors].filter((uid) => !members.some((m) => m.uid === uid));

  const badPreset = presets.some((p) => !p.hours);
  const numberOk = (text: string) => text.trim() === "" || (/^\d{1,2}$/.test(text.trim()) && Number(text) >= 0);
  const invalid = badPreset || !numberOk(minTech) || !numberOk(minOs);

  function toggle(set: Set<string>, update: (next: Set<string>) => void, uid: string, limit?: number) {
    const next = new Set(set);
    if (next.has(uid)) next.delete(uid);
    else {
      if (limit && next.size >= limit) {
        toast.error(`Не больше ${limit}`);
        return;
      }
      next.add(uid);
    }
    update(next);
  }

  async function save() {
    if (invalid || saving) return;
    setSaving(true);
    try {
      const next: ScheduleSettings = {
        editors: [...editors],
        presets: presets
          .filter((p) => p.hours)
          .map((p): ScheduleShiftPreset => ({ ...(p.hours as ScheduleHours), ...(p.name.trim() ? { name: p.name.trim() } : {}) })),
        minOnShift: { tech: Number(minTech) || 0, os: Number(minOs) || 0 },
        hidden: [...hidden],
      };
      await updateScheduleSettings(workspaceId, next);
      toast.success("Настройка графика сохранена");
      onClose();
    } catch (error) {
      toast.error(firestoreErrorText(error, "Не удалось сохранить настройку графика"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="h-4 w-4 shrink-0 text-primary" />
            Настройка графика
          </DialogTitle>
          <DialogDescription>Видна и меняется только у Owner. Действует для всей команды сразу.</DialogDescription>
        </DialogHeader>

        <Block icon={UserCog} title="Кто ещё правит график" hint="Owner и Тимлид правят всегда. Отмеченные получат то же: неделю, месяц, запросы на отметку.">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Найти человека"
            aria-label="Найти человека"
            className="h-10 text-[13px] sm:h-9"
          />
          <div className="flex max-h-56 flex-col gap-0.5 overflow-y-auto rounded-lg border border-border/60 p-1">
            {candidates.length === 0 && <p className="px-2 py-3 text-[12px] text-muted-foreground">Никого не нашли.</p>}
            {candidates.map((m) => (
              <PersonCheck
                key={m.uid}
                id={m.uid}
                label={personLabel(m)}
                sub={ROLE_LABELS[m.role] ?? m.role}
                member={m}
                checked={editors.has(m.uid)}
                onToggle={() => toggle(editors, setEditors, m.uid, SCHEDULE_EDITORS_LIMIT)}
              />
            ))}
            {staleEditors.map((uid) => (
              <PersonCheck key={uid} id={uid} label="Бывший участник" sub="уже не в workspace" checked onToggle={() => toggle(editors, setEditors, uid)} />
            ))}
          </div>
          {editors.size > 0 && <p className="text-[12px] text-muted-foreground">Правят график, кроме руководства: {editors.size}</p>}
        </Block>

        <Block icon={Clock} title="Смены команды" hint="Первые кнопки у каждого поля смены — у кисти, в окне человека и в меню дня.">
          {presets.map((preset, index) => (
            <div key={preset.key} className="flex flex-col gap-1.5 rounded-lg border border-border/60 p-2">
              <div className="flex items-center gap-2">
                <Input
                  value={preset.name}
                  maxLength={24}
                  onChange={(e) =>
                    setPresets((prev) => prev.map((p, i) => (i === index ? { ...p, name: e.target.value } : p)))
                  }
                  placeholder="Название (необязательно): Утро"
                  aria-label="Название смены"
                  className="h-10 min-w-0 flex-1 text-[13px] sm:h-9"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 shrink-0 text-muted-foreground hover:text-destructive sm:h-9 sm:w-9"
                  aria-label="Убрать смену"
                  onClick={() => setPresets((prev) => prev.filter((_, i) => i !== index))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <ShiftField
                compact
                value={preset.hours}
                presets={[]}
                onChange={(hours) => setPresets((prev) => prev.map((p, i) => (i === index ? { ...p, hours } : p)))}
              />
            </div>
          ))}
          {presets.length < SCHEDULE_PRESETS_LIMIT && (
            <Button
              variant="outline"
              size="sm"
              className="min-h-10 gap-1.5 self-start sm:min-h-8"
              onClick={() => setPresets((prev) => [...prev, { key: presetKey(), name: "", hours: null }])}
            >
              <Plus className="h-3.5 w-3.5" />
              Добавить смену
            </Button>
          )}
        </Block>

        <Block icon={Users} title="Норма на смене" hint="Меньше людей в день — число «На смене» красное в неделе, месяце и в «Дне». Пусто — без нормы.">
          <div className="flex flex-wrap gap-3">
            <NormField label="Технарей" value={minTech} onChange={setMinTech} />
            <NormField label="ОС" value={minOs} onChange={setMinOs} />
          </div>
        </Block>

        <Block icon={EyeOff} title="Не показывать в графике" hint="Строка уходит из графика у всех. Сами смены не удаляются — вернуть можно здесь же.">
          <div className="flex max-h-48 flex-col gap-0.5 overflow-y-auto rounded-lg border border-border/60 p-1">
            {people.map((row) => (
              <PersonCheck
                key={row.uid}
                id={row.uid}
                label={row.label}
                sub={row.note ?? undefined}
                member={row.member ?? undefined}
                checked={hidden.has(row.uid)}
                onToggle={() => toggle(hidden, setHidden, row.uid)}
              />
            ))}
          </div>
        </Block>

        <div className="sticky bottom-0 -mx-1 flex items-center gap-2 bg-background/95 px-1 py-2 backdrop-blur">
          {invalid && (
            <span className="text-[12px] text-destructive">
              {badPreset ? "Допишите или уберите смену без времени." : "Норма — число от 0 до 99."}
            </span>
          )}
          <Button variant="ghost" className="ml-auto min-h-11 sm:min-h-0" disabled={saving} onClick={onClose}>
            Отмена
          </Button>
          <Button className="min-h-11 gap-1.5 sm:min-h-0" disabled={invalid || saving} onClick={() => void save()}>
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Сохранить
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Block({ icon: Icon, title, hint, children }: { icon: typeof Clock; title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2 border-t border-border/60 pt-3">
      <p className="flex items-center gap-2 text-sm font-medium">
        <Icon className="h-4 w-4 shrink-0 text-primary" />
        {title}
      </p>
      <p className="text-[12px] text-muted-foreground">{hint}</p>
      {children}
    </section>
  );
}

function NormField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-2 text-[13px]">
      {label}
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, "").slice(0, 2))}
        inputMode="numeric"
        placeholder="—"
        className="h-10 w-16 text-center font-mono sm:h-9"
      />
    </label>
  );
}

function PersonCheck({
  id,
  label,
  sub,
  member,
  checked,
  onToggle,
}: {
  id: string;
  label: string;
  sub?: string;
  member?: { uid: string; name?: string; nickname?: string; photoURL?: string | null };
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label
      className={cn(
        "flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-2 py-1 transition-colors hover:bg-muted/60 sm:min-h-9",
        checked && "bg-primary/[0.07]"
      )}
    >
      <Checkbox checked={checked} onCheckedChange={onToggle} aria-label={label} />
      <MemberAvatar
        id={member?.uid ?? id}
        name={member?.name ?? initialsName(label)}
        nickname={member?.nickname}
        photoURL={member?.photoURL}
        className="h-6 w-6 shrink-0"
      />
      <span className="min-w-0 flex-1 truncate text-[13px]">{label}</span>
      {sub && <span className="shrink-0 text-[11px] text-muted-foreground">{sub}</span>}
    </label>
  );
}
