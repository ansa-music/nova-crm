import {
  deleteField,
  getDocFromServer,
  getDocsFromServer,
  onSnapshot,
  query,
  where,
  writeBatch,
  type FirestoreError,
} from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths, withErrorReporting } from "@/firebase/firestore";
import { nextMonthKey } from "@/services/monthTabService";
import { addScheduleChangesToBatch, type ScheduleDraftChange } from "@/services/techScheduleService";
import {
  hasWeek,
  techScheduleId,
  WEEK_DOWS,
  WEEK_TEMPLATE_DOC_ID,
  type TechSchedule,
  type WeekTemplate,
  type WeekTemplateEntry,
} from "@/types";
import { isEmptyLay, layWeekOnMonth } from "@/utils/weekTemplate";
import { mergeDraftChanges } from "@/utils/scheduleEdit";

/**
 * Неделя графика (см. `types/scheduleTemplate.ts`). `fromServer` — как у
 * `subscribeTechSchedules`: без сети SDK отдаёт снимок из кэша, и править
 * поверх него нельзя — раскладка сочла бы, что недели ни у кого нет.
 */
export function subscribeWeekTemplate(
  workspaceId: string,
  onData: (template: WeekTemplate | null, fromServer: boolean) => void,
  onError?: (error: FirestoreError) => void
) {
  if (!db) {
    onData(null, true);
    return () => {};
  }
  return onSnapshot(
    paths.scheduleTemplate(workspaceId, WEEK_TEMPLATE_DOC_ID),
    { includeMetadataChanges: true },
    (snapshot) => {
      const data = snapshot.exists() ? (snapshot.data() as WeekTemplate) : null;
      onData(data ? { ...data, people: data.people ?? {} } : null, !snapshot.metadata.fromCache);
    },
    withErrorReporting(onError)
  );
}

/**
 * Неделя прямо с сервера — «прошлая неделя» для раскладки. Снимок подписки
 * не годится: пока шла прошлая запись, его могла не догнать ни она сама, ни
 * правка другого руководителя, и раскладка сравнивала бы месяц не с той
 * неделей (вернула бы дни, которые та уже убрала).
 */
export async function fetchWeekTemplateFresh(workspaceId: string): Promise<WeekTemplate | null> {
  if (!db) return null;
  const snap = await getDocFromServer(paths.scheduleTemplate(workspaceId, WEEK_TEMPLATE_DOC_ID));
  if (!snap.exists()) return null;
  const data = snap.data() as WeekTemplate;
  return { ...data, people: data.people ?? {} };
}

/**
 * Запись недели одного человека ПОЛНОСТЬЮ — все семь дней явно: значение или
 * `deleteField()`. При merge:true вложенные карты сливаются, и без явного
 * удаления снятый выходной остался бы в документе. Пустых карт тут не бывает
 * (семь ключей всегда), так что ловушка «пустая карта стирает поле» не грозит.
 */
function entryWrite(entry: WeekTemplateEntry, appliedThrough: string) {
  const days: Record<string, unknown> = {};
  const hours: Record<string, unknown> = {};
  for (const dow of WEEK_DOWS) {
    const key = String(dow);
    const off = entry.days?.[key] === "off";
    days[key] = off ? "off" : deleteField();
    const value = off ? null : entry.hours?.[key];
    hours[key] = value?.from
      ? { from: value.from, to: value.to || "", label: value.label ? value.label : deleteField() }
      : deleteField();
  }
  return { days, hours, appliedThrough };
}

function laterMonth(a: string | undefined, b: string): string {
  return a && a > b ? a : b;
}

/** День месяца «сегодня» по Алматы — с него неделя начинает переписывать график. */
export interface LayWindow {
  currentMonth: string;
  today: number;
}

/** Дальше этого неделя из сетки месяца не раскладывается: каждый месяц — чтение на человека. */
export const LAY_MONTHS_MAX = 4;

/**
 * Месяцы раскладки: текущий (с сегодняшнего дня) и дальше подряд — до
 * следующего или до `throughMonth`, если открыт месяц дальше. Подряд, без
 * пропусков: `appliedThrough` — «разложено ПО этот месяц», и дыра между
 * месяцами не заполнилась бы уже никогда.
 */
export function layMonths(window: LayWindow, throughMonth?: string) {
  const next = nextMonthKey(window.currentMonth);
  const last = throughMonth && throughMonth > next ? throughMonth : next;
  const out = [{ monthKey: window.currentMonth, fromDay: window.today }];
  let key = window.currentMonth;
  while (key < last && out.length < LAY_MONTHS_MAX) {
    key = nextMonthKey(key);
    out.push({ monthKey: key, fromDay: 1 });
  }
  return out;
}

/**
 * Сохранить неделю и сразу разложить её в график: остаток текущего месяца
 * (с сегодняшнего дня) и весь следующий. Всё — ОДНИМ batch с самой неделей:
 * после сбоя посередине иначе осталась бы новая неделя поверх старого месяца,
 * и следующая правка сравнивала бы месяц не с той неделей.
 *
 * Месячные документы читаем С СЕРВЕРА: из кэша без сети пришла бы пустота, и
 * раскладка поверх неё стёрла бы «отпросился» и «пришёл».
 */
export async function saveWeekTemplate(input: {
  workspaceId: string;
  actorUid: string;
  previous: WeekTemplate | null;
  changes: Array<{ personId: string; entry: WeekTemplateEntry }>;
  window: LayWindow;
  /**
   * Разложить и дальше следующего месяца — по этот (открыт в сетке месяц
   * позже следующего). Не больше `LAY_MONTHS_MAX` месяцев подряд.
   */
  throughMonth?: string;
  /**
   * Разовые правки тех же людей той же пачкой: «выходной каждую субботу»
   * из сетки месяца пишет и неделю, и саму выбранную клетку — в том числе
   * прошедшую, куда неделя не раскладывается. Ключи `extra` сильнее раскладки.
   */
  extra?: Array<{ monthKey: string; changes: ScheduleDraftChange[] }>;
}): Promise<{ people: number; days: number }> {
  if (!db) throw new Error("Firebase не настроен");
  if (input.changes.length === 0) return { people: 0, days: 0 };
  const months = layMonths(input.window, input.throughMonth);
  const lastMonth = months[months.length - 1].monthKey;

  const stored = new Map<string, TechSchedule | null>();
  await Promise.all(
    input.changes.flatMap((change) =>
      months.map(async ({ monthKey }) => {
        const id = techScheduleId(change.personId, monthKey);
        const snap = await getDocFromServer(paths.techSchedule(input.workspaceId, id));
        stored.set(id, snap.exists() ? (snap.data() as TechSchedule) : null);
      })
    )
  );

  const byMonth = new Map<string, ScheduleDraftChange[]>(months.map((m) => [m.monthKey, []]));
  const people: Record<string, unknown> = {};
  let dayCount = 0;
  for (const change of input.changes) {
    const previous = input.previous?.people?.[change.personId] ?? null;
    for (const { monthKey, fromDay } of months) {
      // Месяц, который по прошлой неделе ещё не раскладывали, сравниваем с
      // «все дни рабочие» — именно так он и выглядит до первой раскладки.
      const laid = Boolean(previous?.appliedThrough && previous.appliedThrough >= monthKey);
      const lay = layWeekOnMonth({
        monthKey,
        fromDay,
        schedule: stored.get(techScheduleId(change.personId, monthKey)),
        previous: laid ? previous : null,
        next: change.entry,
      });
      if (isEmptyLay(lay)) continue;
      byMonth.get(monthKey)!.push({ uid: change.personId, ...lay });
      dayCount += new Set([...Object.keys(lay.days), ...Object.keys(lay.hours)]).size;
    }
    people[change.personId] = entryWrite(change.entry, laterMonth(previous?.appliedThrough, lastMonth));
  }

  for (const { monthKey, changes } of input.extra ?? []) {
    if (changes.length === 0) continue;
    byMonth.set(monthKey, mergeDraftChanges(byMonth.get(monthKey) ?? [], changes));
  }

  const batch = writeBatch(db);
  batch.set(
    paths.scheduleTemplate(input.workspaceId, WEEK_TEMPLATE_DOC_ID),
    { workspaceId: input.workspaceId, people, updatedAt: Date.now(), updatedBy: input.actorUid },
    { merge: true }
  );
  for (const [monthKey, changes] of byMonth) {
    if (changes.length === 0) continue;
    addScheduleChangesToBatch(batch, { workspaceId: input.workspaceId, monthKey, actorUid: input.actorUid, changes });
  }
  await batch.commit();
  return { people: input.changes.length, days: dayCount };
}

/**
 * Автопилот: у кого неделя разложена не до конца следующего месяца —
 * доразложить. Так 1-го числа новый месяц уже заполнен, и никто не жмёт
 * «разложить» каждый месяц. Запускает сессия руководства (только оно пишет
 * график), обычно — ничего не находит и тратит одно чтение.
 */
export async function layWeekTemplateAhead(input: {
  workspaceId: string;
  actorUid: string;
  window: LayWindow;
}): Promise<number> {
  if (!db) return 0;
  const ref = paths.scheduleTemplate(input.workspaceId, WEEK_TEMPLATE_DOC_ID);
  const snap = await getDocFromServer(ref);
  if (!snap.exists()) return 0;
  const template = snap.data() as WeekTemplate;
  const months = layMonths(input.window);
  const lastMonth = months[months.length - 1].monthKey;
  const due = Object.entries(template.people ?? {}).filter(
    ([, entry]) => hasWeek(entry) && (!entry.appliedThrough || entry.appliedThrough < lastMonth)
  );
  if (due.length === 0) return 0;

  const stored = new Map<string, Map<string, TechSchedule>>();
  for (const { monthKey } of months) {
    if (!due.some(([, entry]) => !entry.appliedThrough || entry.appliedThrough < monthKey)) continue;
    const docs = await getDocsFromServer(
      query(paths.techSchedulesAll(input.workspaceId), where("monthKey", "==", monthKey))
    );
    stored.set(monthKey, new Map(docs.docs.map((d) => [(d.data() as TechSchedule).uid, d.data() as TechSchedule])));
  }

  const byMonth = new Map<string, ScheduleDraftChange[]>(months.map((m) => [m.monthKey, []]));
  const people: Record<string, unknown> = {};
  let dayCount = 0;
  for (const [personId, entry] of due) {
    for (const { monthKey, fromDay } of months) {
      if (entry.appliedThrough && entry.appliedThrough >= monthKey) continue;
      const lay = layWeekOnMonth({
        monthKey,
        fromDay,
        schedule: stored.get(monthKey)?.get(personId),
        previous: null,
        next: entry,
      });
      if (isEmptyLay(lay)) continue;
      byMonth.get(monthKey)!.push({ uid: personId, ...lay });
      dayCount += new Set([...Object.keys(lay.days), ...Object.keys(lay.hours)]).size;
    }
    people[personId] = { appliedThrough: lastMonth };
  }

  const batch = writeBatch(db);
  batch.set(ref, { people }, { merge: true });
  for (const [monthKey, changes] of byMonth) {
    addScheduleChangesToBatch(batch, { workspaceId: input.workspaceId, monthKey, actorUid: input.actorUid, changes });
  }
  await batch.commit();
  return dayCount;
}
