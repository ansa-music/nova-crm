import { useEffect, useMemo, useRef, useState } from "react";
import confetti from "canvas-confetti";
import { Loader2, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { useSiteConfig } from "@/config/siteTerms";
import { isCosmosSite } from "@/config/studio";
import { cn } from "@/utils/cn";
import { cosmosConfettiStyle } from "@/utils/confetti";
import type { OrderCandidate } from "@/services/orderService";
import type { WorkspaceMember } from "@/types";

export type WheelCandidate = OrderCandidate & { member?: WorkspaceMember | null };

interface RandomWheelDialogProps {
  /** Кто крутится в барабане — пул «Рандома», в том же порядке, что и рисуем. */
  pool: WheelCandidate[];
  /** Победитель ВЫБРАН ДО показа (crypto, `pickFromPool`) — колесо его только показывает. */
  winnerUid: string | null;
  orderClient: string;
  /**
   * Записать выдачу. Идёт параллельно вращению: ждать четыре секунды ради
   * записи незачем. Нет — режим зрителя (`watch`): чужой спин, заказ пишет
   * тот, кто крутит.
   */
  onAssign?: () => Promise<void>;
  onClose: () => void;
  /** Смотрим чужой спин: кто крутит. */
  watch?: { byName: string } | null;
  /** «среди откликнувшихся» / «среди свободных» / «своя рулетка» — в подписи. */
  modeLabel?: string | null;
}

const SIZE = 260;
const R = SIZE / 2;
const SPIN_MS = 4200;
/** Сколько полных оборотов накручиваем сверх посадки на сектор. */
const TURNS = 5;

/** Точка на окружности: 0° — наверху, дальше по часовой (как у стрелки). */
function polar(angleDeg: number, radius: number): [number, number] {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return [R + radius * Math.cos(a), R + radius * Math.sin(a)];
}

function sectorPath(from: number, to: number): string {
  const [x1, y1] = polar(from, R - 4);
  const [x2, y2] = polar(to, R - 4);
  const large = to - from > 180 ? 1 : 0;
  return `M ${R} ${R} L ${x1} ${y1} A ${R - 4} ${R - 4} 0 ${large} 1 ${x2} ${y2} Z`;
}

/**
 * Вид «орбита» под «космосом» (воркспейс «NOVA Studio», 06.10.2026): тёмные
 * сектора с тонкой оранжевой кромкой, звёзды за колесом (index.css,
 * `.nova-cosmos-wheel`), светящаяся стрелка. Только краски: углы, посадка на
 * сектор и время вращения те же. Без флага — прежний вид байт в байт.
 */
const COSMOS_SECTOR_FILLS = ["hsl(250 34% 11%)", "hsl(250 28% 16%)", "hsl(252 30% 21%)"] as const;
const COSMOS_WHEEL_SHADOW =
  "0 0 0 1px hsl(var(--primary) / 0.6), 0 0 0 5px hsl(250 32% 7%), 0 0 0 6px hsl(230 100% 82% / 0.22), 0 0 34px -4px hsl(var(--primary) / 0.45), 0 0 70px -12px hsl(230 100% 75% / 0.35)";

function shortName(name: string, count: number): string {
  const limit = count <= 4 ? 14 : count <= 7 ? 11 : 8;
  const clean = name.trim() || "—";
  return clean.length > limit ? `${clean.slice(0, limit - 1)}…` : clean;
}

/**
 * Барабан «Рандома»: кого из откликнувшихся выбрал случай.
 *
 * Важно, что это ЧЕСТНАЯ иллюстрация, а не сам розыгрыш: победителя выбирает
 * `pickFromPool` (crypto) ДО открытия, колесо докручивается ровно до его
 * сектора. Рисовать наоборот («куда остановится — тот и выиграл») нельзя:
 * длительность и остановку анимации браузер не гарантирует — вкладку могут
 * свернуть, — и выдача зависела бы от кадров.
 */
export function RandomWheelDialog({ pool, winnerUid, orderClient, onAssign, onClose, watch, modeLabel = null }: RandomWheelDialogProps) {
  const open = pool.length > 0 && Boolean(winnerUid);
  const winnerIndex = pool.findIndex((c) => c.uid === winnerUid);
  const winner = winnerIndex >= 0 ? pool[winnerIndex] : null;

  const [angle, setAngle] = useState(0);
  const [landed, setLanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const wheelRef = useRef<HTMLDivElement | null>(null);
  // Только вид (с черновиком Конструктора), механику барабана не трогает.
  const cosmos = isCosmosSite(useSiteConfig());

  const seg = 360 / Math.max(pool.length, 1);
  // Небольшой сдвиг внутри сектора — иначе стрелка всегда встаёт ровно по
  // центру и по второму разу видно, что это не бросок, а посадка.
  // Не больше 12°: сектор победителя встаёт под стрелкой, и его подпись,
  // наклонённая на пол-сектора, читалась бы боком.
  const jitter = useMemo(() => (Math.random() - 0.5) * 2 * Math.min(seg * 0.3, 12), [seg]);
  const rotation = useMemo(
    () => (winnerIndex < 0 ? 0 : TURNS * 360 - (winnerIndex * seg + seg / 2) - jitter),
    [winnerIndex, seg, jitter]
  );

  const reduceMotion =
    typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    if (!open) {
      setLanded(false);
      setError(null);
      setSaved(false);
      setAngle(0);
      return;
    }
    let alive = true;
    // Два кадра: браузер обязан СНАЧАЛА отрисовать колесо в нуле, иначе
    // новое значение попадёт в первый же стиль и перехода не будет — колесо
    // просто появится уже повёрнутым.
    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(() => alive && setAngle(rotation));
    });
    // Запись идёт СРАЗУ, параллельно вращению: победитель уже выбран, ждать
    // четыре секунды ради Firestore незачем — и технарь получает заказ раньше.
    void (onAssign ? onAssign() : Promise.resolve())
      .then(() => alive && setSaved(true))
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Не удалось выдать заказ"));
    const timer = window.setTimeout(() => alive && setLanded(true), reduceMotion ? 0 : SPIN_MS);
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
    // onAssign меняется на каждый рендер родителя — перезапускать по нему нельзя.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, winnerUid]);

  useEffect(() => {
    if (!landed || error || !saved) return;
    const rect = wheelRef.current?.getBoundingClientRect();
    void confetti({
      particleCount: 70,
      spread: 62,
      startVelocity: 32,
      disableForReducedMotion: true,
      origin: rect
        ? { x: (rect.left + rect.width / 2) / window.innerWidth, y: (rect.top + rect.height / 2) / window.innerHeight }
        : { y: 0.4 },
      // Под «космосом» — звёзды цветами студии; без флага null и ничего не добавляется.
      ...cosmosConfettiStyle(),
    });
  }, [landed, error, saved]);

  const done = landed && (saved || error);
  // Зритель закрывает когда угодно: заказ пишет не он.
  const closable = Boolean(done || watch);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && closable && onClose()}>
      <DialogContent
        className="max-w-sm"
        // Пока крутится — не закрываем ни Esc, ни кликом мимо: заказ в этот
        // момент уже пишется, и закрытый диалог оставил бы человека без ответа.
        onEscapeKeyDown={(e) => !closable && e.preventDefault()}
        onPointerDownOutside={(e) => !closable && e.preventDefault()}
        onInteractOutside={(e) => !closable && e.preventDefault()}
        data-wheel-watch={watch ? "" : undefined}
      >
        <DialogHeader>
          <DialogTitle>{landed && winner ? `Выпал: ${winner.name}` : "Крутим барабан"}</DialogTitle>
          <DialogDescription>
            {watch && !landed
              ? `${watch.byName || "Выдающий"} крутит барабан · ${orderClient} · в барабане ${pool.length} чел.`
              : landed
              ? error
                ? "Колесо остановилось, но выдать заказ не удалось."
                : `${orderClient} — заказ уходит в стол.`
              : `${orderClient} · в барабане ${pool.length} ${pool.length === 1 ? "человек" : "чел."}${modeLabel ? ` · ${modeLabel}` : ""}`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-1">
          <div ref={wheelRef} className={cn("nova-wheel-enter relative", cosmos && "nova-cosmos-wheel")} style={{ width: SIZE, height: SIZE }}>
            {/* Стрелка сверху — вне вращающегося слоя. */}
            <div className={cn("absolute left-1/2 top-[-6px] z-10 -translate-x-1/2", cosmos && "nova-cosmos-wheel-pointer")}>
              <div
                className="h-0 w-0 border-l-[9px] border-r-[9px] border-t-[16px] border-l-transparent border-r-transparent"
                style={{ borderTopColor: cosmos ? "hsl(var(--primary))" : "hsl(var(--foreground))" }}
              />
            </div>
            <div
              className="h-full w-full rounded-full"
              style={{
                transform: `rotate(${angle}deg)`,
                // Ease-out «как настоящее колесо»: резкий старт, долгий выкат.
                transition: reduceMotion ? "none" : `transform ${SPIN_MS}ms cubic-bezier(0.12, 0.72, 0.1, 1)`,
                boxShadow: cosmos ? COSMOS_WHEEL_SHADOW : "0 0 0 3px hsl(var(--border)), 0 12px 40px -12px hsl(var(--primary) / 0.5)",
              }}
            >
              <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE} height={SIZE} role="img" aria-label="Барабан случайного выбора">
                <circle cx={R} cy={R} r={R} fill={cosmos ? "hsl(250 34% 7%)" : "hsl(var(--card))"} />
                {pool.map((c, i) => {
                  const from = i * seg;
                  const mid = from + seg / 2;
                  // Три тона акцента по кругу; у нечётного числа секторов
                  // последний берёт третий тон, иначе первый и последний
                  // сектора сходились бы одинаковыми.
                  const tone = pool.length % 2 === 1 && i === pool.length - 1 ? 2 : i % 2;
                  const fill = cosmos
                    ? COSMOS_SECTOR_FILLS[tone]
                    : tone === 0
                      ? "hsl(var(--primary) / 0.88)"
                      : tone === 1
                        ? "hsl(var(--primary) / 0.22)"
                        : "hsl(var(--primary) / 0.55)";
                  // На тёмных секторах «орбиты» подпись везде светлая.
                  const text = cosmos ? "hsl(var(--foreground))" : tone === 1 ? "hsl(var(--foreground))" : "hsl(var(--primary-foreground))";
                  const [tx, ty] = polar(mid, R * 0.62);
                  // Подпись идёт ПО ДУГЕ, а не вдоль радиуса. Колесо
                  // останавливается сектором победителя ровно под стрелкой, то
                  // есть наверху, — а наверху дуговая подпись стоит
                  // горизонтально и читается без наклона головы. Радиальные
                  // подписи в барабане, который к тому же сам повёрнут на
                  // случайный угол, вставали боком именно у победителя.
                  // После остановки победитель выделен и рамкой, и тем, что
                  // остальные гаснут: одной стрелки мало — она стоит НАД
                  // колесом и в скриншоте на телефоне почти не читается.
                  const isWinner = i === winnerIndex;
                  // «Орбита»: победитель после остановки подсвечен заливкой акцента.
                  const sectorFill = cosmos && landed && isWinner ? "hsl(var(--primary) / 0.3)" : fill;
                  return (
                    <g
                      key={c.uid}
                      style={{ opacity: landed && !isWinner ? 0.45 : 1, transition: "opacity 320ms ease" }}
                    >
                      {/* Один участник — это круг целиком: дуга от 0° до 360°
                          вырождается в точку и не рисуется вовсе. */}
                      {pool.length === 1 ? (
                        <circle cx={R} cy={R} r={R - 4} fill={sectorFill} />
                      ) : (
                        <path
                          d={sectorPath(from, from + seg)}
                          fill={sectorFill}
                          stroke={
                            cosmos
                              ? landed && isWinner
                                ? "hsl(var(--primary))"
                                : "hsl(var(--primary) / 0.5)"
                              : landed && isWinner
                                ? "hsl(var(--foreground))"
                                : "hsl(var(--card))"
                          }
                          strokeWidth={cosmos ? (landed && isWinner ? 2 : 0.9) : landed && isWinner ? 2.5 : 1.5}
                        />
                      )}
                      <text
                        x={tx}
                        y={ty}
                        fill={text}
                        fontSize={pool.length > 7 ? 10 : 12}
                        fontWeight={600}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        transform={`rotate(${mid} ${tx} ${ty})`}
                      >
                        {shortName(c.name, pool.length)}
                      </text>
                    </g>
                  );
                })}
                {cosmos ? (
                  <>
                    {/* Орбиты: пунктир по ободу и тонкое внутреннее кольцо; ступица светится. */}
                    <circle cx={R} cy={R} r={R - 2} fill="none" stroke="hsl(230 100% 82% / 0.45)" strokeWidth={1} strokeDasharray="1 5" />
                    <circle cx={R} cy={R} r={R * 0.36} fill="none" stroke="hsl(var(--primary) / 0.35)" strokeWidth={0.75} />
                    <circle cx={R} cy={R} r={22} fill="hsl(250 34% 8%)" stroke="hsl(var(--primary) / 0.8)" strokeWidth={1.5} />
                    <circle cx={R} cy={R} r={13} fill="hsl(var(--primary) / 0.2)" />
                    <circle cx={R} cy={R} r={6} fill="hsl(var(--primary))" />
                  </>
                ) : (
                  <>
                    <circle cx={R} cy={R} r={22} fill="hsl(var(--card))" stroke="hsl(var(--border))" strokeWidth={2} />
                    <circle cx={R} cy={R} r={6} fill="hsl(var(--primary))" />
                  </>
                )}
              </svg>
            </div>
          </div>

          {landed && winner ? (
            <div
              className={cn(
                "flex w-full items-center gap-3 rounded-xl border p-3",
                error ? "border-destructive/40 bg-destructive/10" : "border-primary/40 bg-primary/[0.08]"
              )}
            >
              <MemberAvatar
                id={winner.uid}
                name={winner.member?.name ?? winner.name}
                nickname={winner.member?.nickname}
                photoURL={winner.member?.photoURL}
                className="h-10 w-10 shrink-0"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{winner.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {error ?? (watch ? `Выпал заказ «${orderClient}»` : saved ? "Заказ выдан" : "Записываем…")}
                </p>
              </div>
              {!saved && !error ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : error ? null : (
                <Trophy className="h-4 w-4 shrink-0 text-primary" />
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Победителя уже выбрал случай — колесо просто его показывает.</p>
          )}
        </div>

        <Button className="w-full" disabled={!closable} onClick={onClose}>
          {done ? "Готово" : watch ? "Закрыть" : "Крутится…"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
