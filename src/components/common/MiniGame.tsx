import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Play, RotateCcw, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * Маленькая «Змейка» для перерыва (просьба Nurba 12.10.2026: «лёгкая игра с
 * рекордом, рядом с Грок лимитом, без названия»). Кнопка-значок в верхней
 * панели открывает это окно. Игра целиком в браузере: в базу ничего не пишет,
 * рекорд личный — в localStorage этого устройства. Грузится отдельным чанком,
 * только когда окно открыли.
 */

const CELLS = 16;
const TICK_MS = 125;
const BEST_KEY = "nova:minigame-best";

type Point = { x: number; y: number };
type Dir = "up" | "down" | "left" | "right";

const STEP: Record<Dir, Point> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};
const OPPOSITE: Record<Dir, Dir> = { up: "down", down: "up", left: "right", right: "left" };
const KEY_DIR: Record<string, Dir> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  KeyW: "up",
  KeyS: "down",
  KeyA: "left",
  KeyD: "right",
};

function readBest(): number {
  try {
    return Math.max(0, Number(localStorage.getItem(BEST_KEY)) || 0);
  } catch {
    return 0;
  }
}

function saveBest(value: number) {
  try {
    localStorage.setItem(BEST_KEY, String(value));
  } catch {
    /* приватное окно — рекорд проживёт до закрытия вкладки */
  }
}

function freeCell(snake: Point[]): Point {
  const taken = new Set(snake.map((p) => `${p.x}:${p.y}`));
  const free: Point[] = [];
  for (let y = 0; y < CELLS; y++) for (let x = 0; x < CELLS; x++) if (!taken.has(`${x}:${y}`)) free.push({ x, y });
  return free[Math.floor(Math.random() * free.length)] ?? { x: 0, y: 0 };
}

const START: Point[] = [
  { x: 7, y: 8 },
  { x: 6, y: 8 },
  { x: 5, y: 8 },
];

type Phase = "idle" | "playing" | "over";

export default function MiniGame({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Состояние игры — в ref: тик идёт по таймеру, и перерисовывать React на
  // каждый шаг незачем. В state — только то, что видно в подписи.
  const snakeRef = useRef<Point[]>(START);
  const foodRef = useRef<Point>({ x: 11, y: 8 });
  const dirRef = useRef<Dir>("right");
  /** Очередь поворотов: два быстрых нажатия за один тик не теряются и не разворачивают змейку в себя. */
  const queueRef = useRef<Dir[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(readBest);
  /** В этой партии рекорд побит (а не просто повторён). */
  const [beaten, setBeaten] = useState(false);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const css = getComputedStyle(document.documentElement);
    const color = (name: string, alpha = 1) => `hsl(${css.getPropertyValue(name).trim()} / ${alpha})`;
    const size = canvas.width / CELLS;
    ctx.fillStyle = color("--background");
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = color("--border", 0.6);
    for (let i = 1; i < CELLS; i++) {
      ctx.fillRect(i * size, 0, 1, canvas.height);
      ctx.fillRect(0, i * size, canvas.width, 1);
    }
    const food = foodRef.current;
    ctx.fillStyle = color("--success");
    ctx.beginPath();
    ctx.arc((food.x + 0.5) * size, (food.y + 0.5) * size, size * 0.32, 0, Math.PI * 2);
    ctx.fill();
    snakeRef.current.forEach((p, i) => {
      ctx.fillStyle = color("--primary", i === 0 ? 1 : 0.72);
      ctx.fillRect(p.x * size + 2, p.y * size + 2, size - 3, size - 3);
    });
  }, []);

  const reset = useCallback(() => {
    snakeRef.current = START;
    foodRef.current = freeCell(START);
    dirRef.current = "right";
    queueRef.current = [];
    setScore(0);
    setBeaten(false);
  }, []);

  const start = useCallback(() => {
    reset();
    setPhase("playing");
  }, [reset]);

  const turn = useCallback((next: Dir) => {
    const queue = queueRef.current;
    const last = queue[queue.length - 1] ?? dirRef.current;
    if (next === last || next === OPPOSITE[last] || queue.length >= 2) return;
    queue.push(next);
  }, []);

  // Окно закрыли — игра останавливается, а не тикает в фоне.
  useEffect(() => {
    if (open) return;
    setPhase("idle");
    reset();
  }, [open, reset]);

  useEffect(() => {
    if (!open) return;
    // Canvas появляется в портале диалога на кадр позже.
    const t = window.setTimeout(draw, 30);
    return () => window.clearTimeout(t);
  }, [open, phase, draw]);

  useEffect(() => {
    if (!open || phase !== "playing") return;
    const timer = window.setInterval(() => {
      const next = queueRef.current.shift();
      if (next) dirRef.current = next;
      const step = STEP[dirRef.current];
      const snake = snakeRef.current;
      const head = { x: snake[0].x + step.x, y: snake[0].y + step.y };
      const grow = head.x === foodRef.current.x && head.y === foodRef.current.y;
      // Хвост уедет на этом же тике — в него врезаться нельзя, если не растём.
      const body = grow ? snake : snake.slice(0, -1);
      const dead =
        head.x < 0 || head.y < 0 || head.x >= CELLS || head.y >= CELLS || body.some((p) => p.x === head.x && p.y === head.y);
      if (dead) {
        setPhase("over");
        return;
      }
      snakeRef.current = [head, ...body];
      if (grow) {
        foodRef.current = freeCell(snakeRef.current);
        const value = snakeRef.current.length - START.length;
        setScore(value);
        if (value > readBest()) {
          saveBest(value);
          setBest(value);
          setBeaten(true);
        }
      }
      draw();
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [open, phase, draw]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const dir = KEY_DIR[e.code];
      if (dir) {
        // Стрелки не должны крутить страницу и двигать фокус по окну.
        e.preventDefault();
        if (phase === "playing") turn(dir);
        else start();
        return;
      }
      if ((e.code === "Space" || e.code === "Enter") && phase !== "playing") {
        e.preventDefault();
        start();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, phase, turn, start]);

  // Свайпы по полю — для планшета.
  const touchRef = useRef<Point | null>(null);

  const arrow = (dir: Dir, Icon: typeof ArrowUp, label: string) => (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className="h-11 w-11"
      aria-label={label}
      onClick={() => (phase === "playing" ? turn(dir) : start())}
    >
      <Icon className="h-4 w-4" />
    </Button>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-3 pr-6">
            <span>Перерыв</span>
            <span className="flex items-center gap-3 font-mono text-[13px] font-medium tabular-nums">
              <span>{score}</span>
              <span className="flex items-center gap-1 text-warning" title="Ваш рекорд на этом устройстве">
                <Trophy className="h-3.5 w-3.5" /> {best}
              </span>
            </span>
          </DialogTitle>
          <DialogDescription>Стрелки или WASD. Съешьте как можно больше и не врежьтесь.</DialogDescription>
        </DialogHeader>

        <div className="relative mx-auto w-full max-w-[320px]">
          <canvas
            ref={canvasRef}
            width={320}
            height={320}
            className="block aspect-square w-full touch-none rounded-lg border border-border"
            onTouchStart={(e) => {
              const t = e.touches[0];
              touchRef.current = { x: t.clientX, y: t.clientY };
            }}
            onTouchEnd={(e) => {
              const from = touchRef.current;
              const t = e.changedTouches[0];
              touchRef.current = null;
              if (!from) return;
              const dx = t.clientX - from.x;
              const dy = t.clientY - from.y;
              if (Math.max(Math.abs(dx), Math.abs(dy)) < 16) return;
              const dir: Dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
              if (phase === "playing") turn(dir);
              else start();
            }}
          />
          {phase !== "playing" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-lg bg-background/80">
              {phase === "over" && (
                <p className="text-sm font-medium">
                  {beaten ? `Новый рекорд: ${score}` : `Счёт: ${score}`}
                </p>
              )}
              <Button type="button" className="gap-1.5" onClick={start}>
                {phase === "over" ? <RotateCcw className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                {phase === "over" ? "Ещё раз" : "Играть"}
              </Button>
            </div>
          )}
        </div>

        {/* Кнопки — для тача и мыши; на клавиатуре хватает стрелок. */}
        <div className="mx-auto grid grid-cols-3 gap-1.5">
          <span />
          {arrow("up", ArrowUp, "Вверх")}
          <span />
          {arrow("left", ArrowLeft, "Влево")}
          {arrow("down", ArrowDown, "Вниз")}
          {arrow("right", ArrowRight, "Вправо")}
        </div>
      </DialogContent>
    </Dialog>
  );
}
