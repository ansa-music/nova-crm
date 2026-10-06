import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { saveDataMode } from "@/config/pageLoaders";

/**
 * Фон «мифический космос» воркспейса «NOVA Studio» (06.10.2026). Грузится
 * лениво из `CosmosBackdropHost` и только при `theme.fx === "cosmos"`.
 *
 * Как устроен (map G §5, §11.3):
 * - слой `position: fixed; inset: 0; z-index: -1` ВНУТРИ `#root` (он stacking
 *   context): рисуется над фоном body и под всем содержимым. `contain: strict`
 *   стоит на САМОМ слое — он не предок контента, fixed-окна не сдвигает;
 * - всё на CSS (index.css, блок «космос»): туманность — статичные градиенты,
 *   два тайла звёзд медленно дрейфуют (`transform`), мерцание — `opacity`,
 *   «аврора» — opacity/transform, кольцо рун медленно вращается, орбита —
 *   статична. Ни `background-position`, ни `filter` на анимированных слоях —
 *   только композитор;
 * - «трансформация»: при смене раздела — короткий (500 мс) «варп» на самом
 *   фоне. Фон не предок контента, поэтому transform здесь безопасен (на
 *   PageShell/main его ставить нельзя — сдвинет fixed-оверлеи);
 * - на таче, при «меньше движения» и экономии трафика — статика без
 *   бесконечных анимаций; пауза — свёрнутая вкладка, стол (`/page/…`: окно
 *   таблицы непрозрачно, фон почти не виден), открытый диалог и клавиатура
 *   (последние два — чистым CSS по `body[data-scroll-locked]` и
 *   `html[data-keyboard="open"]`).
 */

/** Сколько длится «варп» смены раздела — и в CSS тоже (`.nova-cosmos-warp`). */
const WARP_MS = 500;

/** Позиционирование — инлайном: до прихода CSS слой уже вне потока и невидим для мыши. */
const ROOT_STYLE = {
  position: "fixed",
  inset: 0,
  zIndex: -1,
  pointerEvents: "none",
  overflow: "hidden",
  contain: "strict",
} as const;

function useDocumentHidden(): boolean {
  const [hidden, setHidden] = useState(() => typeof document !== "undefined" && document.hidden);
  useEffect(() => {
    const onChange = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
  return hidden;
}

function CosmosBackdrop() {
  const { pathname } = useLocation();
  const coarse = useMediaQuery("(hover: none), (pointer: coarse)");
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const saveData = useMemo(() => saveDataMode(), []);
  const hidden = useDocumentHidden();

  // Статика: без бесконечных анимаций (батарея телефона, «меньше движения»,
  // экономия трафика). Варп — разовый, его гасит только «меньше движения».
  const isStatic = coarse || reduced || saveData;
  const onTable = pathname.startsWith("/page/");
  const paused = hidden || onTable;

  const prevPath = useRef(pathname);
  const [warp, setWarp] = useState<number | null>(null);

  useEffect(() => {
    if (prevPath.current === pathname) return;
    prevPath.current = pathname;
    // На стол — незачем: окно таблицы закрывает фон целиком.
    if (reduced || saveData || document.hidden || pathname.startsWith("/page/")) {
      setWarp(null);
      return;
    }
    setWarp(Date.now());
  }, [pathname, reduced, saveData]);

  // Слой варпа снимаем после анимации: держать полноэкранный слой ради
  // прозрачного последнего кадра незачем. Таймер — у каждого варпа свой:
  // перезапуск эффекта выше (смена «меньше движения») не оставит слой висеть.
  useEffect(() => {
    if (warp === null) return;
    const timer = window.setTimeout(() => setWarp(null), WARP_MS + 120);
    return () => window.clearTimeout(timer);
  }, [warp]);

  return (
    <div
      className="nova-cosmos-root"
      style={ROOT_STYLE}
      aria-hidden="true"
      data-static={isStatic ? "" : undefined}
      data-paused={paused ? "" : undefined}
    >
      <div className="nova-cosmos-aurora nova-cosmos-anim" />
      <div className="nova-cosmos-stars nova-cosmos-stars-a nova-cosmos-anim" />
      <div className="nova-cosmos-stars nova-cosmos-stars-b nova-cosmos-anim" />
      <div key={warp ? `core-${warp}` : "core"} className="nova-cosmos-core" data-run={warp ? "" : undefined} />
      <div className="nova-cosmos-orbit">
        <div className="nova-cosmos-orbit-arc" />
      </div>
      <div className="nova-cosmos-runes nova-cosmos-anim">
        <RuneRing />
      </div>
      {warp ? <div key={`warp-${warp}`} className="nova-cosmos-warp" /> : null}
    </div>
  );
}

export default memo(CosmosBackdrop);

// ---------------------------------------------------------------------
// Кольцо рун и созвездие — одна статичная SVG, вращается весь слой.
// ---------------------------------------------------------------------

/** Знаки старшего футарка штрихами (поле ~12×22, центр в нуле): шрифтов с рунами на телефонах может не быть. */
const RUNE_GLYPHS = [
  "M -4 -11 V 11 M -4 -6 L 5 -11 M -4 1 L 5 -4", // ᚠ
  "M -5 11 V -11 L 5 -5 V 11", // ᚢ
  "M -4 -11 V 11 M -4 -5 L 4 0 L -4 5", // ᚦ
  "M -4 -11 V 11 M -4 -11 L 4 -6 M -4 -4 L 4 1", // ᚨ
  "M -4 11 V -11 L 4 -6 L -4 -1 L 4 11", // ᚱ
  "M 4 -11 L -4 0 L 4 11", // ᚲ
  "M -6 -11 L 6 11 M 6 -11 L -6 11", // ᚷ
  "M -5 -11 V 11 M 5 -11 V 11 M -5 -3 L 5 3", // ᚺ
  "M 0 11 V -11 M -6 -11 L 0 -3 L 6 -11", // ᛉ
  "M 0 11 V -11 M -6 -5 L 0 -11 L 6 -5", // ᛏ
  "M -6 11 L 6 -1 L 0 -9 L -6 -1 L 6 11", // ᛟ
  "M 3 -11 L -4 -3 L 4 3 L -3 11", // ᛊ
];

const RUNE_COUNT = 24;
const RUNE_RADIUS = 425;

function ticksPath(): string {
  const parts: string[] = [];
  for (let i = 0; i < 72; i += 1) {
    const a = ((i * 5 - 90) * Math.PI) / 180;
    const inner = i % 6 === 0 ? 470 : 476;
    const outer = 484;
    const x1 = (inner * Math.cos(a)).toFixed(1);
    const y1 = (inner * Math.sin(a)).toFixed(1);
    const x2 = (outer * Math.cos(a)).toFixed(1);
    const y2 = (outer * Math.sin(a)).toFixed(1);
    parts.push(`M ${x1} ${y1} L ${x2} ${y2}`);
  }
  return parts.join(" ");
}

const TICKS = ticksPath();

/** Созвездие внутри кольца: точки — «золото» (только свечение), линии — звёздный лёд. */
const STARS: Array<[number, number, number]> = [
  [-228, -96, 4],
  [-142, -188, 3],
  [-34, -150, 3.5],
  [62, -226, 4.5],
  [168, -132, 3],
  [118, -22, 3.5],
  [214, 86, 3],
  [64, 168, 4],
  [-74, 118, 3],
  [-186, 36, 3.5],
];

const CONSTELLATION =
  "M -228 -96 L -142 -188 L -34 -150 L 62 -226 L 168 -132 L 118 -22 M 118 -22 L 214 86 L 64 168 L -74 118 L -186 36";

const RuneRing = memo(function RuneRing() {
  return (
    <svg viewBox="-500 -500 1000 1000" width="100%" height="100%" fill="none">
      <g stroke="hsl(230 100% 82%)" strokeLinecap="round" strokeLinejoin="round">
        <circle r={488} strokeWidth={1.2} />
        <circle r={466} strokeWidth={0.8} />
        <path d={TICKS} strokeWidth={1.4} />
        <circle r={444} strokeWidth={2} strokeDasharray="1 11" />
        <circle r={402} strokeWidth={0.8} />
        {Array.from({ length: RUNE_COUNT }, (_, i) => (
          <path
            key={i}
            d={RUNE_GLYPHS[i % RUNE_GLYPHS.length]}
            strokeWidth={1.6}
            transform={`rotate(${(360 / RUNE_COUNT) * i}) translate(0 ${-RUNE_RADIUS})`}
          />
        ))}
        <circle r={330} strokeWidth={0.7} strokeDasharray="2 14" />
        <path d={CONSTELLATION} strokeWidth={1} strokeOpacity={0.8} />
        <path d="M 0 -58 L 12 -12 L 58 0 L 12 12 L 0 58 L -12 12 L -58 0 L -12 -12 Z" strokeWidth={1.2} />
        <circle r={22} strokeWidth={0.8} />
      </g>
      <g fill="hsl(36 100% 74%)">
        {STARS.map(([x, y, r]) => (
          <g key={`${x}:${y}`}>
            <circle cx={x} cy={y} r={r * 3} fillOpacity={0.18} />
            <circle cx={x} cy={y} r={r} />
          </g>
        ))}
      </g>
    </svg>
  );
});
