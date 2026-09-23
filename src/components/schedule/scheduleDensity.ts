import { useCallback, useState } from "react";

/**
 * Масштаб сетки графика: «чтобы не приходилось щуриться» (просьба Nurba).
 * Выбор — удобство одного человека на одном устройстве, поэтому
 * localStorage, а не база. По умолчанию «Обычный» — он крупнее прежней сетки.
 */
export type ScheduleDensity = "compact" | "normal" | "large";

const KEY = "nova:schedule-density";

function read(): ScheduleDensity {
  try {
    const value = window.localStorage.getItem(KEY);
    if (value === "compact" || value === "normal" || value === "large") return value;
  } catch {
    // Приватное окно / заблокированное хранилище — просто по умолчанию.
  }
  return "normal";
}

export function useScheduleDensity(): [ScheduleDensity, (next: ScheduleDensity) => void] {
  const [density, setDensity] = useState<ScheduleDensity>(read);
  const set = useCallback((next: ScheduleDensity) => {
    setDensity(next);
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      // см. выше
    }
  }, []);
  return [density, set];
}

/** Размеры сетки месяца по масштабу — одна таблица, чтобы секции не разъезжались. */
export const MONTH_SIZES: Record<
  ScheduleDensity,
  { cell: string; cellText: string; dayNum: string; dayNumBox: string; dow: string; name: string; nameCol: string; avatar: string; nameMax: string; nameMaxRm: string }
> = {
  compact: {
    cell: "h-7 w-7",
    cellText: "text-[10px]",
    dayNum: "text-[10px]",
    dayNumBox: "w-6",
    dow: "text-[9px]",
    name: "text-[12px]",
    nameCol: "w-28 min-w-[7rem] sm:w-40 sm:min-w-[10rem]",
    avatar: "h-6 w-6",
    nameMax: "max-w-[4.5rem] sm:max-w-[7.5rem]",
    nameMaxRm: "max-w-[3.25rem] sm:max-w-[6.25rem]",
  },
  normal: {
    cell: "h-9 w-9",
    cellText: "text-[12px]",
    dayNum: "text-[12px]",
    dayNumBox: "w-7",
    dow: "text-[10px]",
    name: "text-[13px]",
    nameCol: "w-32 min-w-[8rem] sm:w-48 sm:min-w-[12rem]",
    avatar: "h-7 w-7",
    nameMax: "max-w-[5.5rem] sm:max-w-[9rem]",
    nameMaxRm: "max-w-[4rem] sm:max-w-[7.5rem]",
  },
  large: {
    cell: "h-11 w-11",
    cellText: "text-[14px]",
    dayNum: "text-[14px]",
    dayNumBox: "w-8",
    dow: "text-[11px]",
    name: "text-[15px]",
    nameCol: "w-36 min-w-[9rem] sm:w-56 sm:min-w-[14rem]",
    avatar: "h-8 w-8",
    nameMax: "max-w-[6.5rem] sm:max-w-[11rem]",
    nameMaxRm: "max-w-[5rem] sm:max-w-[9.5rem]",
  },
};

/** Размеры недели. */
export const WEEK_SIZES: Record<ScheduleDensity, { cell: string; text: string; name: string; col: string; avatar: string; nameMax: string }> = {
  compact: {
    cell: "h-9 min-w-[4rem]",
    text: "text-[11px]",
    name: "text-[12px]",
    col: "w-28 min-w-[7rem] sm:w-44 sm:min-w-[11rem]",
    avatar: "h-6 w-6",
    nameMax: "max-w-[4.5rem] sm:max-w-[8.5rem]",
  },
  normal: {
    cell: "h-11 min-w-[4.5rem]",
    text: "text-[13px]",
    name: "text-[13px]",
    col: "w-32 min-w-[8rem] sm:w-52 sm:min-w-[13rem]",
    avatar: "h-7 w-7",
    nameMax: "max-w-[5.5rem] sm:max-w-[10rem]",
  },
  large: {
    cell: "h-14 min-w-[5.5rem]",
    text: "text-[15px]",
    name: "text-[15px]",
    col: "w-36 min-w-[9rem] sm:w-60 sm:min-w-[15rem]",
    avatar: "h-8 w-8",
    nameMax: "max-w-[6.5rem] sm:max-w-[12rem]",
  },
};
