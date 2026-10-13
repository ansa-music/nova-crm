import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Circle, Play, RotateCcw, Trophy } from "lucide-react";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace } from "@/hooks/useWorkspace";
import { fetchGameBoard, gameBoardAvailable, submitGameScore, type GameScoreRow } from "@/services/gameScoreService";
import { cn } from "@/utils/cn";
import { displayNameOf } from "@/utils/displayName";
import {
  BLOCK_H,
  FIELD_H,
  FIELD_W,
  LANES,
  LANE_W,
  PLAYER_H,
  PLAYER_Y,
  createLaneGame,
  moveToLane,
  stepLaneGame,
  type LaneGameState,
} from "@/utils/laneGame";

/**
 * «Три полосы» — игра для перерыва (просьба Nurba 13.10.2026: «убери змейку,
 * сделай простую игру, где надо уворачиваться: налево, направо и центр — три
 * дорожки, и рейтинг среди тех, кто играл»). До этого здесь была «Змейка»
 * (12.10.2026) с личным рекордом в localStorage.
 *
 * Кнопка-значок в верхней панели открывает это окно (`MiniGameHost`); код
 * грузится отдельным чанком, только когда окно открыли. Правила — в
 * `utils/laneGame.ts`, здесь отрисовка, управление и рейтинг. Рейтинг — в
 * Supabase (`services/gameScoreService.ts`); где его нет, игра работает с
 * личным рекордом на устройстве.
 */

/**
 * Личный рекорд на этом устройстве — по workspace и человеку: рейтинг у
 * каждого workspace свой (рекорд из одного не должен сам уезжать в другой),
 * а на общем компьютере рекорды разных людей не смешиваются.
 */
const bestKey = (workspaceId: string, uid: string) => `nova:lanes-best:${workspaceId || "none"}:${uid || "anon"}`;
/** Сколько мест рейтинга показываем; своя строка дописывается ниже, если она дальше. */
const BOARD_TOP = 10;
/** После проигрыша нажатия полос не перезапускают игру сразу — иначе итог не успеть увидеть. */
const RESTART_LOCK_MS = 600;

const LANE_KEYS: Record<string, number | "left" | "right"> = {
  ArrowLeft: "left",
  KeyA: "left",
  ArrowRight: "right",
  KeyD: "right",
  ArrowDown: 1,
  ArrowUp: 1,
  KeyS: 1,
  KeyW: 1,
  Digit1: 0,
  Digit2: 1,
  Digit3: 2,
  Numpad1: 0,
  Numpad2: 1,
  Numpad3: 2,
};

function readBest(workspaceId: string, uid: string): number {
  try {
    return Math.max(0, Number(localStorage.getItem(bestKey(workspaceId, uid))) || 0);
  } catch {
    return 0;
  }
}

function saveBest(workspaceId: string, uid: string, value: number) {
  try {
    localStorage.setItem(bestKey(workspaceId, uid), String(value));
  } catch {
    /* приватное окно — рекорд проживёт до закрытия вкладки */
  }
}

type Phase = "idle" | "playing" | "over";
/** undefined — читается, null — общего рейтинга нет. */
type Board = GameScoreRow[] | null | undefined;

const laneCenter = (lane: number) => lane * LANE_W + LANE_W / 2;

interface Palette {
  background: string;
  lane: string;
  border: string;
  block: string;
  player: string;
  glass: string;
}

/** Цвета темы для canvas (HSL-триплеты из CSS-переменных). */
function readPalette(): Palette {
  const css = getComputedStyle(document.documentElement);
  const color = (name: string, alpha = 1) => `hsl(${css.getPropertyValue(name).trim()} / ${alpha})`;
  return {
    background: color("--background"),
    lane: color("--foreground", 0.04),
    border: color("--border"),
    block: color("--destructive"),
    player: color("--primary"),
    glass: color("--background", 0.45),
  };
}

export default function MiniGame({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { profile } = useAuth();
  const { activeWorkspace, activeWorkspaceId, members } = useWorkspace();
  const uid = profile?.uid ?? "";
  const workspaceId = activeWorkspaceId ?? "";
  const boardOn = Boolean(workspaceId && uid && gameBoardAvailable(activeWorkspace));

  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Состояние игры — в ref: кадр идёт по requestAnimationFrame, и перерисовывать
  // React на каждый кадр незачем. В state — только то, что видно в подписи.
  const gameRef = useRef<LaneGameState>(createLaneGame());
  /** Где игрок нарисован (px): полоса меняется сразу, картинка доезжает за пару кадров. */
  const playerXRef = useRef(laneCenter(1));
  const overAtRef = useRef(0);
  const paletteRef = useRef<Palette | null>(null);
  /** Номер запроса рейтинга: ответ на устаревший (сменили workspace) не показываем. */
  const boardReqRef = useRef(0);
  /** Окно ещё открыто: ответ базы, пришедший после закрытия, никуда не пишем. */
  const aliveRef = useRef(true);
  const [phase, setPhase] = useState<Phase>("idle");
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(() => readBest(workspaceId, uid));
  /** В этой партии рекорд побит (а не просто повторён). */
  const [beaten, setBeaten] = useState(false);
  const [board, setBoard] = useState<Board>(boardOn ? undefined : null);
  /** Последний счёт не лёг в рейтинг (сеть, отказ) — скажем об этом под списком. */
  const [saveFailed, setSaveFailed] = useState(false);

  // Свежие значения для колбэков, которые живут дольше одного рендера.
  const live = useRef({ uid, workspaceId, boardOn, best });
  live.current = { uid, workspaceId, boardOn, best };

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    // Плотность экрана бывает дробной (2.625 на телефонах): размер холста —
    // целый, иначе сравнение не сходилось бы и холст пересоздавался каждый кадр.
    const width = Math.round(FIELD_W * Math.min(3, window.devicePixelRatio || 1));
    const scale = width / FIELD_W;
    if (canvas.width !== width) {
      canvas.width = width;
      canvas.height = Math.round(FIELD_H * scale);
    }
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    const palette = paletteRef.current ?? (paletteRef.current = readPalette());
    const game = gameRef.current;
    const block = (x: number, y: number, w: number, h: number, radius: number) => {
      ctx.beginPath();
      if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, w, h, radius);
      else ctx.rect(x, y, w, h);
      ctx.fill();
    };

    ctx.fillStyle = palette.background;
    ctx.fillRect(0, 0, FIELD_W, FIELD_H);
    // Полоса игрока — чуть светлее: видно, куда встал, ещё до того как доехала картинка.
    ctx.fillStyle = palette.lane;
    ctx.fillRect(game.lane * LANE_W, 0, LANE_W, FIELD_H);
    // Разметка между полосами едет вниз вместе с блоками — так чувствуется скорость.
    ctx.fillStyle = palette.border;
    const dash = 18;
    const offset = game.distance % (dash * 2);
    for (let lane = 1; lane < LANES; lane++) {
      for (let y = offset - dash * 2; y < FIELD_H; y += dash * 2) ctx.fillRect(lane * LANE_W - 1, y, 2, dash);
    }
    ctx.fillStyle = palette.block;
    for (const wave of game.waves) {
      wave.blocked.forEach((on, lane) => {
        if (on) block(lane * LANE_W + 8, wave.y, LANE_W - 16, BLOCK_H, 8);
      });
    }
    const x = playerXRef.current;
    ctx.fillStyle = game.dead ? palette.block : palette.player;
    block(x - (LANE_W - 32) / 2, PLAYER_Y, LANE_W - 32, PLAYER_H, 10);
    ctx.fillStyle = palette.glass;
    block(x - (LANE_W - 48) / 2, PLAYER_Y + 8, LANE_W - 48, 9, 4);
  }, []);

  const loadBoard = useCallback(async () => {
    if (!aliveRef.current) return;
    const { workspaceId: ws, boardOn: on, uid: me } = live.current;
    const request = ++boardReqRef.current;
    if (!on || !ws) {
      setBoard(null);
      return;
    }
    let rows = await fetchGameBoard(ws);
    // Пока читали, запросили заново (сменился workspace, эффект сработал
    // дважды) — этот ответ уже не нужен, и досылать рекорд второй раз нельзя.
    if (request !== boardReqRef.current) return;
    if (rows) {
      const serverBest = rows.find((r) => r.uid === me)?.best ?? 0;
      const local = readBest(ws, me);
      if (local > serverBest) {
        // Рекорд поставлен, когда рейтинг был недоступен (сеть) — дошлём его.
        if (await submitGameScore(ws, local)) rows = (await fetchGameBoard(ws)) ?? rows;
      } else if (serverBest > local) {
        // Рекорд с другого устройства.
        saveBest(ws, me, serverBest);
        if (request === boardReqRef.current) setBest(serverBest);
      }
    }
    if (request === boardReqRef.current) setBoard(rows);
  }, []);

  const reset = useCallback(() => {
    gameRef.current = createLaneGame();
    playerXRef.current = laneCenter(gameRef.current.lane);
    setScore(0);
    setBeaten(false);
  }, []);

  const start = useCallback(() => {
    if (Date.now() - overAtRef.current < RESTART_LOCK_MS) return;
    reset();
    setPhase("playing");
  }, [reset]);

  const finish = useCallback(() => {
    const value = gameRef.current.score;
    const { uid: me, workspaceId: ws, boardOn: on, best: prevBest } = live.current;
    overAtRef.current = Date.now();
    setPhase("over");
    if (value > prevBest) {
      saveBest(ws, me, value);
      setBest(value);
      setBeaten(true);
    }
    if (value <= 0 || !on || !ws) return;
    void submitGameScore(ws, value).then((saved) => {
      if (!aliveRef.current) return;
      // Не лёг обычный счёт — рейтинг от этого не меняется; не лёг рекорд —
      // он остался на устройстве и дошлётся при следующем открытии окна.
      setSaveFailed(!saved && value > prevBest);
      if (saved) void loadBoard();
    });
  }, [loadBoard]);

  /** Игрок встаёт на полосу (число) или шагает на соседнюю. */
  const go = useCallback((to: number | "left" | "right") => {
    const game = gameRef.current;
    moveToLane(game, to === "left" ? game.lane - 1 : to === "right" ? game.lane + 1 : to);
  }, []);

  /** Нажатие полосы: в игре — встать на неё, вне игры — начать. */
  const press = useCallback(
    (to: number | "left" | "right") => {
      if (phase === "playing") go(to);
      else start();
    },
    [phase, go, start]
  );

  // Окно закрыли — игра останавливается, а не идёт в фоне.
  useEffect(() => {
    if (open) return;
    setPhase("idle");
    reset();
  }, [open, reset]);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      // Запрос рейтинга, который ещё в пути, становится устаревшим.
      boardReqRef.current += 1;
    };
  }, []);

  // Рейтинг и рекорд — при открытии и при смене человека или workspace.
  useEffect(() => {
    if (!open) return;
    setBest(readBest(workspaceId, uid));
    setSaveFailed(false);
    setBoard(boardOn ? undefined : null);
    void loadBoard();
  }, [open, uid, workspaceId, boardOn, loadBoard]);

  useEffect(() => {
    if (!open) return;
    // Тему могли сменить между партиями — цвета перечитываем на каждую фазу.
    paletteRef.current = null;
    // Canvas появляется в портале диалога на кадр позже.
    const t = window.setTimeout(draw, 30);
    return () => window.clearTimeout(t);
  }, [open, phase, draw]);

  useEffect(() => {
    if (!open || phase !== "playing") return;
    let raf = 0;
    let last = performance.now();
    let shown = 0;
    const frame = (now: number) => {
      const dt = now - last;
      last = now;
      const game = gameRef.current;
      stepLaneGame(game, dt, Math.random);
      playerXRef.current += (laneCenter(game.lane) - playerXRef.current) * Math.min(1, Math.max(0, dt) / 70);
      if (game.score !== shown) {
        shown = game.score;
        setScore(shown);
      }
      draw();
      if (game.dead) {
        finish();
        return;
      }
      raf = window.requestAnimationFrame(frame);
    };
    raf = window.requestAnimationFrame(frame);
    return () => window.cancelAnimationFrame(raf);
  }, [open, phase, draw, finish]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const lane = LANE_KEYS[e.code];
      if (lane !== undefined) {
        // Клавиши игры не должны крутить страницу и доходить до таблицы под окном.
        e.preventDefault();
        e.stopPropagation();
        if (phase === "playing") go(lane);
        return;
      }
      if ((e.code === "Space" || e.code === "Enter") && phase !== "playing") {
        // На кнопке Enter и пробел нажимают саму кнопку — не дублируем.
        if (e.target instanceof HTMLElement && e.target.closest("button, a")) return;
        e.preventDefault();
        e.stopPropagation();
        start();
      }
    };
    // Фаза перехвата: раньше общих горячих клавиш приложения.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, phase, go, start]);

  const memberByUid = useMemo(() => new Map(members.map((m) => [m.uid, m])), [members]);
  const myIndex = board ? board.findIndex((r) => r.uid === uid) : -1;
  const boardRows = useMemo(() => {
    if (!board) return [];
    const top = board.slice(0, BOARD_TOP).map((row, i) => ({ row, place: i + 1 }));
    if (myIndex >= BOARD_TOP) top.push({ row: board[myIndex], place: myIndex + 1 });
    return top;
  }, [board, myIndex]);

  const laneButton = (lane: number, label: string, aria: string, Icon: typeof ArrowLeft) => (
    <Button type="button" variant="outline" className="h-11 gap-1.5 px-2" aria-label={aria} onClick={() => press(lane)}>
      <Icon className={cn("shrink-0", Icon === Circle ? "h-2.5 w-2.5" : "h-4 w-4")} />
      <span className="text-[12.5px]">{label}</span>
    </Button>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-3 pr-6">
            <span>Перерыв</span>
            <span className="flex items-center gap-3 font-mono text-[13px] font-medium tabular-nums">
              <span title="Счёт этой партии">{score}</span>
              <span className="flex items-center gap-1 text-warning" title="Ваш рекорд">
                <Trophy className="h-3.5 w-3.5" /> {best}
              </span>
            </span>
          </DialogTitle>
          <DialogDescription>
            Три полосы: уходите от красных блоков. Стрелки ← → или A / D, на телефоне — нажмите на нужную полосу.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-[300px_minmax(0,1fr)]">
          <div className="mx-auto w-full max-w-[300px]">
            <div className="relative">
              <canvas
                ref={canvasRef}
                width={FIELD_W}
                height={FIELD_H}
                aria-label="Игровое поле: три полосы"
                className="block w-full touch-none select-none rounded-lg border border-border"
                style={{ aspectRatio: `${FIELD_W} / ${FIELD_H}` }}
                onPointerDown={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  if (rect.width <= 0) return;
                  press(Math.min(LANES - 1, Math.max(0, Math.floor(((e.clientX - rect.left) / rect.width) * LANES))));
                }}
              />
              {phase !== "playing" && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-lg bg-background/80 px-4 text-center">
                  {phase === "over" && (
                    <div>
                      <p className="text-sm font-medium">{beaten ? `Новый рекорд: ${score}` : `Счёт: ${score}`}</p>
                      {myIndex >= 0 && board && !saveFailed ? (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          Место в рейтинге: {myIndex + 1} из {board.length}
                        </p>
                      ) : null}
                    </div>
                  )}
                  <Button type="button" className="gap-1.5" onClick={start}>
                    {phase === "over" ? <RotateCcw className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                    {phase === "over" ? "Ещё раз" : "Играть"}
                  </Button>
                </div>
              )}
            </div>
            {/* Кнопки полос — для тача и мыши; на клавиатуре хватает стрелок. */}
            <div className="mt-2 grid grid-cols-3 gap-1.5">
              {laneButton(0, "Левая", "Левая полоса", ArrowLeft)}
              {laneButton(1, "Центр", "Центральная полоса", Circle)}
              {laneButton(2, "Правая", "Правая полоса", ArrowRight)}
            </div>
          </div>

          <section aria-label="Рейтинг" className="min-w-0">
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <h3 className="text-sm font-medium">Рейтинг</h3>
              {board && board.length > 0 ? <span className="text-xs text-muted-foreground">играли: {board.length}</span> : null}
            </div>
            {board === undefined ? (
              <p className="py-3 text-xs text-muted-foreground">Читаю рейтинг…</p>
            ) : board === null ? (
              <p className="py-3 text-xs text-muted-foreground">
                Общий рейтинг сейчас недоступен — ваш рекорд хранится на этом устройстве.
              </p>
            ) : board.length === 0 ? (
              <p className="py-3 text-xs text-muted-foreground">Пока никто не играл — будьте первым.</p>
            ) : (
              <ol className="flex flex-col divide-y divide-border rounded-lg border border-border">
                {boardRows.map(({ row, place }, i) => {
                  const member = memberByUid.get(row.uid) ?? null;
                  const label = member ? displayNameOf(member) : "Бывший участник";
                  const mine = row.uid === uid;
                  // Своя строка за пределами верха списка — после разрыва.
                  const gap = i === BOARD_TOP && place > BOARD_TOP + 1;
                  return (
                    <li
                      key={row.uid}
                      className={cn("flex items-center gap-2 px-2.5 py-1.5", mine && "bg-primary/10", gap && "border-t-2 border-dashed")}
                      title={`Партий: ${row.plays}`}
                    >
                      <span className={cn("w-6 shrink-0 text-right font-mono text-xs tabular-nums", place <= 3 ? "font-semibold text-warning" : "text-muted-foreground")}>
                        {place}
                      </span>
                      <MemberAvatar id={row.uid} name={label} photoURL={member?.photoURL} className="h-5 w-5" />
                      <span className="min-w-0 flex-1 truncate text-[13px]">
                        {label}
                        {mine ? <span className="ml-1.5 text-[11px] text-primary">вы</span> : null}
                      </span>
                      <span className="shrink-0 font-mono text-[13px] font-medium tabular-nums">{row.best}</span>
                    </li>
                  );
                })}
              </ol>
            )}
            {saveFailed && board ? (
              <p className="mt-1.5 text-[11px] text-warning">Рекорд не записался в рейтинг — дошлём, когда откроете окно в следующий раз.</p>
            ) : null}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
