import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Dices, Hand, Loader2, Sparkles, X } from "lucide-react";
import { cn } from "@/utils/cn";
import { lastRandomMode, RANDOM_MODE_LABELS, rememberRandomMode, type RandomMode } from "@/services/orderService";

export interface RandomModeStat {
  count: number;
  /** Почему пул пуст; null — есть кого крутить. */
  reason: string | null;
}

export type RandomModeStats = Record<RandomMode, RandomModeStat>;

interface RandomModeChooserProps {
  /** Считается в момент раскрытия: кандидатов у каждой карточки заказа считать заранее незачем. */
  statsOf: () => RandomModeStats;
  onPick: (mode: RandomMode) => void;
  disabled?: boolean;
  busy?: boolean;
  /**
   * NOVA Studio (только вид): подсвечен всегда «Откликнулись» — в маленькой
   * команде «Свободных» (без работ в процессе) почти не бывает. Выбор в студии
   * не запоминается: память режима общая на устройство, и выбор в студии
   * переписывал бы привычный режим в других компаниях.
   */
  studio?: boolean;
}

const MODES: RandomMode[] = ["claimed", "free"];
const SPRING = { type: "spring", stiffness: 520, damping: 34, mass: 0.7 } as const;

/**
 * «Рандом» на карточке заказа: по нажатию кнопка САМА превращается в выбор —
 * среди кого крутить (просьба Nurba 05.10.2026: «среди откликнувшихся или среди
 * тех, у кого нет в работе заказов; используй эффекты трансформаций»).
 *
 * Рамка перетекает по ширине (`layout`), кубик поворачивается и уменьшается,
 * чипы режимов выезжают каскадом и сжимаются при нажатии. Esc, клик мимо и
 * уход фокуса — свернуть. `prefers-reduced-motion` — без трансформаций.
 */
export function RandomModeChooser({ statsOf, onPick, disabled = false, busy = false, studio = false }: RandomModeChooserProps) {
  const reduce = useReducedMotion() ?? false;
  const [stats, setStats] = useState<RandomModeStats | null>(null);
  const open = stats !== null;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const last = open ? (studio ? "claimed" : lastRandomMode()) : null;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setStats(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setStats(null);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (busy) setStats(null);
  }, [busy]);

  const t = reduce ? { duration: 0 } : SPRING;

  return (
    <motion.div
      ref={rootRef}
      layout={!reduce}
      transition={t}
      data-random-chooser={open ? "open" : "closed"}
      onBlur={(e) => {
        if (open && !rootRef.current?.contains(e.relatedTarget as Node | null)) setStats(null);
      }}
      className={cn(
        "inline-flex h-8 items-center overflow-hidden border",
        open ? "gap-1 rounded-lg border-primary/40 bg-primary/[0.06] p-0.5 shadow-sm" : "rounded-md border-border bg-background"
      )}
      style={{ originX: 0 }}
    >
      <AnimatePresence initial={false} mode="wait">
        {!open ? (
          <motion.button
            key="trigger"
            type="button"
            layout={!reduce}
            disabled={disabled || busy}
            onClick={() => setStats(statsOf())}
            initial={reduce ? false : { opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={reduce ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, scale: 0.85, transition: { duration: 0.1 } }}
            transition={t}
            whileTap={reduce ? undefined : { scale: 0.94 }}
            className="group inline-flex h-full items-center gap-1.5 px-3 text-[13px] font-medium transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
            aria-haspopup="true"
            aria-expanded={false}
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Dices className="h-3.5 w-3.5 transition-transform duration-300 group-hover:-rotate-12 group-hover:scale-110" />
            )}
            Рандом
          </motion.button>
        ) : (
          <motion.div
            key="choices"
            layout={!reduce}
            className="flex h-full items-center gap-1"
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduce ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, scale: 0.92, transition: { duration: 0.1 } }}
            transition={t}
            role="group"
            aria-label="Среди кого крутить «Рандом»"
          >
            <motion.span
              aria-hidden
              className="grid h-7 w-6 place-items-center text-primary"
              initial={reduce ? false : { rotate: 0, scale: 1.2 }}
              animate={{ rotate: reduce ? 0 : 180, scale: 0.9 }}
              transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 16 }}
            >
              <Dices className="h-3.5 w-3.5" />
            </motion.span>
            {MODES.map((mode, i) => {
              const s = stats[mode];
              const off = s.count === 0;
              const Icon = mode === "claimed" ? Hand : Sparkles;
              return (
                <motion.button
                  key={mode}
                  type="button"
                  data-random-mode={mode}
                  disabled={off}
                  title={off ? (s.reason ?? "Некого крутить") : `Крутить ${RANDOM_MODE_LABELS[mode].among}: ${s.count} чел.`}
                  onClick={() => {
                    if (!studio) rememberRandomMode(mode);
                    setStats(null);
                    onPick(mode);
                  }}
                  initial={reduce ? false : { opacity: 0, scale: 0.85, x: -8 }}
                  animate={{ opacity: 1, scale: 1, x: 0 }}
                  transition={reduce ? { duration: 0 } : { ...SPRING, delay: 0.04 * (i + 1) }}
                  whileHover={reduce || off ? undefined : { y: -1 }}
                  whileTap={reduce || off ? undefined : { scale: 0.92 }}
                  className={cn(
                    "inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-md border px-2 text-[12px] font-medium transition-colors",
                    off
                      ? "cursor-not-allowed border-transparent text-muted-foreground/60"
                      : "border-border bg-background hover:border-primary/50 hover:text-primary",
                    !off && last === mode && "border-primary/50 text-primary"
                  )}
                >
                  <Icon className="h-3 w-3" />
                  {RANDOM_MODE_LABELS[mode].short}
                  <span className={cn("font-mono text-[11px] tabular-nums", off ? "opacity-60" : "text-muted-foreground")}>
                    · {s.count}
                  </span>
                </motion.button>
              );
            })}
            <motion.button
              type="button"
              aria-label="Свернуть"
              onClick={() => setStats(null)}
              initial={reduce ? false : { opacity: 0, rotate: -90 }}
              animate={{ opacity: 1, rotate: 0 }}
              transition={reduce ? { duration: 0 } : { ...SPRING, delay: 0.12 }}
              className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
