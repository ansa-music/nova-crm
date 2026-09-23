import { formatScheduleHours, type ScheduleHours } from "@/types/techSchedule";

/**
 * Настройка графика — «Настройка графика» у Owner (поле `scheduleSettings`
 * документа workspace). Лежит в документе workspace, а не отдельной
 * коллекцией: его и так слушает каждая вкладка, и лишнего слушателя на Spark
 * не нужно. Правит ТОЛЬКО Owner — правило workspace закрывает поле Тимлиду.
 */
export interface ScheduleShiftPreset extends ScheduleHours {
  /** «Утро», «Вечер» — подпись кнопки; в график уходят только часы. */
  name?: string;
}

export interface ScheduleSettings {
  /**
   * Кто ЕЩЁ правит график, кроме Owner и Тимлида (старший ОС, админ смены).
   * Право держат правила: `isScheduleEditor` в firestore.rules читает этот
   * список из документа workspace.
   */
  editors?: string[];
  /** Смены команды — первые кнопки у каждого поля смены. */
  presets?: ScheduleShiftPreset[];
  /** Норма на смене: меньше — день в «На смене» подсвечен красным. 0/нет — без нормы. */
  minOnShift?: { tech?: number; os?: number };
  /** Кого не показывать в графике (Owner без смен и т.п.). Данные не трогаются. */
  hidden?: string[];
}

export const SCHEDULE_EDITORS_LIMIT = 20;
export const SCHEDULE_PRESETS_LIMIT = 8;

/** Настройка с пустыми значениями вместо отсутствующих — читать без `?.` на каждом шагу. */
export function scheduleSettingsOf(
  workspace: { scheduleSettings?: ScheduleSettings | null } | null | undefined
): Required<Omit<ScheduleSettings, "minOnShift">> & { minOnShift: { tech: number; os: number } } {
  const raw = workspace?.scheduleSettings ?? {};
  const clampMin = (value: unknown) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.min(99, Math.floor(n)) : 0;
  };
  return {
    editors: Array.isArray(raw.editors) ? raw.editors.filter((uid) => typeof uid === "string" && uid) : [],
    presets: Array.isArray(raw.presets) ? raw.presets.filter((p) => p && typeof p.from === "string" && p.from) : [],
    minOnShift: { tech: clampMin(raw.minOnShift?.tech), os: clampMin(raw.minOnShift?.os) },
    hidden: Array.isArray(raw.hidden) ? raw.hidden.filter((uid) => typeof uid === "string" && uid) : [],
  };
}

/**
 * Что пишем в базу. Ни одного `undefined` (ignoreUndefinedProperties
 * выключен — запись упала бы целиком), дубли и пустые смены выкинуты.
 */
export function sanitizeScheduleSettings(input: ScheduleSettings): ScheduleSettings {
  const clean = scheduleSettingsOf({ scheduleSettings: input });
  const seen = new Set<string>();
  const presets: ScheduleShiftPreset[] = [];
  for (const preset of clean.presets) {
    const key = `${preset.from}|${preset.to || ""}|${preset.label || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const next: ScheduleShiftPreset = { from: preset.from, to: preset.to || "" };
    if (preset.label) next.label = preset.label;
    const name = (preset.name ?? "").trim().slice(0, 24);
    if (name) next.name = name;
    presets.push(next);
    if (presets.length >= SCHEDULE_PRESETS_LIMIT) break;
  }
  return {
    editors: Array.from(new Set(clean.editors)).slice(0, SCHEDULE_EDITORS_LIMIT),
    presets,
    minOnShift: { tech: clean.minOnShift.tech, os: clean.minOnShift.os },
    hidden: Array.from(new Set(clean.hidden)).slice(0, 200),
  };
}

/** Смены команды, затем частые — без повторов, не больше `limit`. */
export function mergeShiftPresets(team: ScheduleShiftPreset[], frequent: ScheduleHours[], limit = 8): ScheduleShiftPreset[] {
  const seen = new Set<string>();
  const out: ScheduleShiftPreset[] = [];
  for (const hours of [...team, ...frequent]) {
    const key = formatScheduleHours(hours);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(hours);
    if (out.length >= limit) break;
  }
  return out;
}
