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

/**
 * Размеры сетки по масштабу — одна таблица на месяц и неделю, чтобы разделы
 * и виды не разъезжались. «Обычно» подобрано так, чтобы месяц целиком влезал
 * в экран 1440 px без прокрутки вбок.
 */
export const SHEET_SIZES: Record<
  ScheduleDensity,
  {
    monthCell: string;
    monthText: string;
    weekCell: string;
    weekText: string;
    head: string;
    headSub: string;
    name: string;
    nameCol: string;
    avatar: string;
    count: string;
  }
> = {
  compact: {
    monthCell: "h-7 w-7",
    monthText: "text-[10px]",
    weekCell: "h-8 min-w-[3.75rem]",
    weekText: "text-[11px]",
    head: "text-[11px]",
    headSub: "text-[9px]",
    name: "text-[12px]",
    nameCol: "w-28 min-w-[7rem] max-w-[7rem] sm:w-40 sm:min-w-[10rem] sm:max-w-[10rem]",
    avatar: "h-6 w-6",
    count: "text-[10px]",
  },
  normal: {
    monthCell: "h-[34px] w-[34px]",
    monthText: "text-[12px]",
    weekCell: "h-10 min-w-[4.25rem]",
    weekText: "text-[13px]",
    head: "text-[12px]",
    headSub: "text-[10px]",
    name: "text-[13px]",
    nameCol: "w-32 min-w-[8rem] max-w-[8rem] sm:w-44 sm:min-w-[11rem] sm:max-w-[11rem]",
    avatar: "h-7 w-7",
    count: "text-[11px]",
  },
  large: {
    monthCell: "h-10 w-10",
    monthText: "text-[14px]",
    weekCell: "h-12 min-w-[5rem]",
    weekText: "text-[15px]",
    head: "text-[14px]",
    headSub: "text-[11px]",
    name: "text-[15px]",
    nameCol: "w-36 min-w-[9rem] max-w-[9rem] sm:w-52 sm:min-w-[13rem] sm:max-w-[13rem]",
    avatar: "h-8 w-8",
    count: "text-[12px]",
  },
};
