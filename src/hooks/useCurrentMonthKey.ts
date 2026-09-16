import { useEffect, useState } from "react";
import { currentMonthKey } from "@/services/monthTabService";

/** "YYYY-MM" in Asia/Almaty; flips on its own at midnight on the 1st while the app stays open. */
export function useCurrentMonthKey(): string {
  const [monthKey, setMonthKey] = useState(() => currentMonthKey());

  useEffect(() => {
    const timer = window.setInterval(() => {
      const next = currentMonthKey();
      setMonthKey((prev) => (prev === next ? prev : next));
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  return monthKey;
}
