import { useCallback, useMemo, useRef, useState } from "react";
import { waitForPendingWrites } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { fetchWeekTemplateFresh, saveWeekTemplate } from "@/services/scheduleTemplateService";
import { saveScheduleDraft, type ScheduleDraftChange } from "@/services/techScheduleService";
import { ymdInTimeZone } from "@/utils/date";
import { withDbTimeout } from "@/utils/dbError";
import type { WeekPersonChange } from "@/utils/scheduleEdit";
import type { WeekCell } from "@/types";

interface Job {
  id: number;
  changes: WeekPersonChange[];
}

export interface WeekSaveInput {
  changes: WeekPersonChange[];
  /** Разовые правки месяца той же пачкой («выходной каждую субботу» из сетки месяца). */
  extra?: Array<{ monthKey: string; changes: ScheduleDraftChange[] }>;
  /** Разложить неделю по этот месяц (открыт в сетке месяц дальше следующего). */
  throughMonth?: string;
}

/**
 * Запись постоянной недели прямо из сетки — без режима правки и «Сохранить».
 *
 * Правки идут по ОЧЕРЕДИ: каждая читает месяцы с сервера и раскладывает
 * неделю, сравнивая месяц с ПРОШЛОЙ неделей человека. Две параллельные
 * записи сравнивали бы с одной и той же старой неделей, и вторая откатывала
 * бы раскладку первой. Поэтому «прошлую неделю» каждая запись читает с
 * сервера сама — уже после того, как дошли предыдущие записи.
 *
 * Пока запись в пути, её клетки показываются сразу (`overlay`): чтение
 * месяцев с сервера занимает доли секунды, и без этого клик казался бы
 * несработавшим.
 */
export function useWeekTemplateWriter({ workspaceId, actorUid }: { workspaceId: string | null; actorUid: string }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());
  const seqRef = useRef(0);

  /** Неделя человека, какой она станет после записей в пути (последняя — сверху). */
  const overlay = useMemo(() => {
    const map = new Map<string, Record<string, WeekCell>>();
    for (const job of jobs) for (const change of job.changes) map.set(change.personId, change.cells);
    return map;
  }, [jobs]);

  const save = useCallback(
    async (input: WeekSaveInput) => {
      if (!workspaceId) throw new Error("Нет активного workspace");
      if (input.changes.length === 0 && !(input.extra ?? []).some((m) => m.changes.length > 0)) return;
      const id = ++seqRef.current;
      setJobs((prev) => [...prev, { id, changes: input.changes }]);
      const run = queueRef.current.then(async () => {
        // Раскладка читает месяцы С СЕРВЕРА. Правка клетки, сделанная секунду
        // назад, может ещё не дойти туда — и раскладка не увидела бы её
        // (например, «отпросился»), а своей пачкой переписала бы день. Без
        // связи ожидание не кончилось бы никогда — поэтому с пределом.
        if (db) await withDbTimeout(waitForPendingWrites(db), "Постоянная неделя не сохранена");
        if (input.changes.length === 0) {
          // Неделя уже такая — пишем только разовые клетки месяца.
          for (const month of input.extra ?? []) {
            if (month.changes.length === 0) continue;
            await saveScheduleDraft({ workspaceId, monthKey: month.monthKey, actorUid, changes: month.changes });
          }
          return;
        }
        const previous = await withDbTimeout(fetchWeekTemplateFresh(workspaceId), "Постоянная неделя не сохранена");
        // Месяц и день — из ОДНОГО чтения часов в момент записи: иначе в
        // первую минуту 1-го числа пара «прошлый месяц + день 1» переписала
        // бы весь прошедший месяц.
        const nowYmd = ymdInTimeZone(Date.now());
        await saveWeekTemplate({
          workspaceId,
          actorUid,
          previous,
          changes: input.changes.map((change) => ({ personId: change.personId, entry: change.entry })),
          window: { currentMonth: nowYmd.slice(0, 7), today: Number(nowYmd.slice(8, 10)) },
          throughMonth: input.throughMonth,
          extra: input.extra,
        });
      });
      queueRef.current = run.catch(() => {});
      try {
        await run;
      } finally {
        setJobs((prev) => prev.filter((job) => job.id !== id));
      }
    },
    [workspaceId, actorUid]
  );

  return { overlay, save, busy: jobs.length > 0 };
}
