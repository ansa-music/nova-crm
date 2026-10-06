import { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, Check, Dices, Hand, Loader2, Maximize2, Sparkles } from "lucide-react";
import { TechPickerSheet } from "@/components/os/TechPickerSheet";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { timeAgo } from "@/utils/date";
import { cn } from "@/utils/cn";
import {
  lastRandomMode,
  RANDOM_MODE_LABELS,
  randomPoolProblemOf,
  rememberRandomMode,
  type OrderCandidate,
  type RandomMode,
  type RandomWeightOf,
} from "@/services/orderService";
import type { RandomRequest } from "@/hooks/useOrderAssignment";
import { usePermissions } from "@/hooks/usePermissions";
import { toast } from "@/components/ui/sonner";
import { useWorkspace } from "@/hooks/useWorkspace";
import { bigOrderRowKey, bigQueueView, isBigCheck, noteBigQueuePick, useBigOrderQueue } from "@/services/bigOrderQueueService";
import { chancePercents, orderClaimScope, type WorkOrder, type WorkspaceMember } from "@/types";
import { useStudioMode } from "@/config/studio";
import { useTerms } from "@/config/siteTerms";

interface AssignOrderDialogProps {
  order: WorkOrder | null;
  onOpenChange: (open: boolean) => void;
  candidates: Array<OrderCandidate & { member: WorkspaceMember; deskName: string | null }>;
  onAssign: (candidate: OrderCandidate) => Promise<void>;
  /** `{ mode }` — «Рандом» среди откликнувшихся или свободных, `{ uids }` — «Своя рулетка». */
  onRandom: (request: RandomRequest) => Promise<void>;
  /** Пул «Рандома» и веса — из `useOrderAssignment`, чтобы кнопка и бросок считали одинаково. */
  randomPoolFor: (order: WorkOrder, mode?: RandomMode) => OrderCandidate[];
  /** Проценты у Owner: вес в этом пуле при этой сумме чека. */
  weightFor: (poolUids: readonly string[], checkTotal?: number | null) => RandomWeightOf;
  /** Открыть окно сразу в «Своей рулетке» (тост с карточки заказа). */
  startCustom?: boolean;
}

/** «Кому отдать»: откликнувшиеся сверху, остальные технари ниже; без стола — не выбрать. */
export function AssignOrderDialog({
  order,
  onOpenChange,
  candidates,
  onAssign,
  onRandom,
  randomPoolFor,
  weightFor,
  startCustom = false,
}: AssignOrderDialogProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // «Своя рулетка»: кого выдающий отметил крутить. null — обычный список.
  const [custom, setCustom] = useState<Set<string> | null>(null);
  const { activeWorkspaceId } = useWorkspace();
  // Шансы «Рандома» видит только Owner (ответ Nurba 03.10.2026).
  const { actsAsOwner } = usePermissions();
  // «Заказ от 300к+»: только очередь ответственного, без «Рандома» и списка.
  const bigView = bigQueueView(useBigOrderQueue(activeWorkspaceId, Boolean(order)));
  const bigOrder = Boolean(order && bigView && bigView.queue.length > 0 && isBigCheck(order.price, bigView.threshold));
  const claimed = candidates.filter((c) => c.claimedAt != null).sort((a, b) => (a.claimedAt ?? 0) - (b.claimedAt ?? 0));
  const others = candidates.filter((c) => c.claimedAt == null);
  const reduce = useReducedMotion() ?? false;
  // NOVA Studio (только вид): исполнители — «менеджеры», режим по умолчанию —
  // «Откликнулись» (см. RandomModeChooser). У остальных — как было.
  const studio = useStudioMode();
  const t = useTerms();
  // Среди кого крутить — выбирает выдающий (просьба Nurba 05.10.2026). Тот же пул,
  // что и у броска, — иначе карточка работает, а окно выключено (или наоборот).
  const pools: Record<RandomMode, OrderCandidate[]> = {
    claimed: order ? randomPoolFor(order, "claimed") : [],
    free: order ? randomPoolFor(order, "free") : [],
  };
  const reasons: Record<RandomMode, string | null> = {
    claimed: order && pools.claimed.length === 0 ? (randomPoolProblemOf(candidates, "claimed", orderClaimScope(order)) ?? "Некому выдать") : null,
    free: order && pools.free.length === 0 ? (randomPoolProblemOf(candidates, "free", orderClaimScope(order)) ?? "Некому выдать") : null,
  };
  const [mode, setMode] = useState<RandomMode>("claimed");
  const randomPool = pools[mode];
  const eligibleCustom = (c: OrderCandidate) => c.hasDesk && !c.absentToday;

  const orderId = order?.id ?? null;
  // Новое окно (другой заказ) — заново: обычный список или сразу рулетка.
  useEffect(() => {
    if (!orderId) {
      setCustom(null);
      return;
    }
    setCustom(startCustom ? initialCustom() : null);
    // Студия: всегда «Откликнулись»; запомненный режим устройства не читаем и не пишем.
    if (studio) {
      setMode("claimed");
      return;
    }
    // Режим по умолчанию: где есть кого крутить, при равных — последний выбранный.
    const remembered = lastRandomMode() ?? "claimed";
    const other: RandomMode = remembered === "claimed" ? "free" : "claimed";
    setMode(pools[remembered].length > 0 || pools[other].length === 0 ? remembered : other);
    // initialCustom читает кандидатов на момент открытия — нарочно без них в зависимостях.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, startCustom]);

  function initialCustom(): Set<string> {
    return new Set(candidates.filter((c) => c.claimedAt != null && eligibleCustom(c)).map((c) => c.uid));
  }

  const customUids = useMemo(
    () => (custom ? candidates.filter((c) => custom.has(c.uid) && eligibleCustom(c)).map((c) => c.uid) : []),
    [custom, candidates]
  );
  // randomPool пересчитывается на каждый рендер — шансы считаем по составу.
  const poolKey = randomPool.map((c) => c.uid).join(",");
  const chances = useMemo(() => {
    if (!actsAsOwner) return null;
    const uids = custom ? customUids : poolKey ? poolKey.split(",") : [];
    return chancePercents(uids, weightFor(uids, order?.price ?? null));
  }, [actsAsOwner, custom, customUids, poolKey, weightFor, order?.price]);

  /** Отдать и, если заказ крупный, убрать получившего из очереди «300к+». */
  async function assign(c: OrderCandidate) {
    await onAssign(c);
    // Ключ заказа: у заказа со стола ОС — адрес строки (тот же, что при выдаче со
    // стола), иначе id заказа — повторная выдача не считается дважды.
    const key = order ? (order.osSource ? bigOrderRowKey(order.osSource.pageId, order.osSource.rowId) : `order:${order.id}`) : null;
    noteBigQueuePick(activeWorkspaceId, c.uid, order?.price ?? null, key);
  }

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    try {
      await fn();
      onOpenChange(false);
    } catch (error) {
      // Без этого отказ уходил в пустоту: спиннер гас, диалог оставался
      // открытым, и человек жал кнопку снова и снова.
      toast.error(error instanceof Error ? error.message : "Не удалось выдать заказ");
    } finally {
      setBusy(null);
    }
  }

  function row(c: (typeof candidates)[number]) {
    const disabled = !c.hasDesk || busy !== null;
    return (
      <button
        key={c.uid}
        type="button"
        disabled={disabled}
        onClick={() => void run(c.uid, () => assign(c))}
        className={cn(
          "flex w-full items-center gap-3 rounded-xl border p-2.5 text-left transition-colors",
          c.hasDesk ? "border-border hover:border-primary/40 hover:bg-accent/40" : "border-border/60 opacity-60",
          c.claimedAt != null && c.hasDesk && "border-primary/30 bg-primary/[0.05]"
        )}
      >
        <MemberAvatar id={c.uid} name={c.member.name} nickname={c.member.nickname} photoURL={c.member.photoURL} className="h-8 w-8 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-medium">{c.name}</span>
            {/* Занятость и выходной — предупреждение, а не запрет: отдать
                напрямую можно кому угодно со столом, это решение выдающего. */}
            {c.blockedReason && (
              <span className="shrink-0 rounded-full border border-warning/40 bg-warning/10 px-1.5 text-[10px] leading-4 text-warning">
                {c.blockedReason}
              </span>
            )}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {c.deskName ?? "стола нет — забрать некуда"}
            {c.claimedAt != null ? ` · откликнулся ${timeAgo(c.claimedAt)}` : ""}
          </p>
        </div>
        {chances?.has(c.uid) ? (
          <span className="shrink-0 rounded-md border border-primary/30 bg-primary/10 px-1.5 font-mono text-[10.5px] leading-5 text-primary" title="Шанс в «Рандоме» — видит только Owner">
            {chances.get(c.uid)} %
          </span>
        ) : null}
        {busy === c.uid ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : c.claimedAt != null ? (
          <Hand className="h-4 w-4 shrink-0 text-primary" />
        ) : null}
      </button>
    );
  }

  const byUid = new Map(candidates.map((c) => [c.uid, c]));
  const byUidAll = byUid;
  return (
    <>
    <TechPickerSheet
      open={(pickerOpen || bigOrder) && Boolean(order)}
      checkTotal={order?.price ?? null}
      title={order ? `Кому отдать «${order.client}»?` : "Кому отдать"}
      description="Свободные и без заказов — сверху; метка «откликнулся» — у тех, кто уже отозвался на заказ."
      busy={busy !== null}
      requireNick={false}
      onlyUids={new Set(byUid.keys())}
      problemOf={(uid) => {
        const c = byUid.get(uid);
        if (!c) return "Не может взять этот заказ";
        return c.hasDesk ? null : "Нет своего стола";
      }}
      markOf={(uid) => (byUid.get(uid)?.claimedAt != null ? "откликнулся" : null)}
      onPick={(tech) => {
        const c = byUid.get(tech.uid);
        if (c) void run(c.uid, () => assign(c)).then(() => setPickerOpen(false));
      }}
      onClose={() => (bigOrder ? onOpenChange(false) : setPickerOpen(false))}
    />
    <Dialog open={Boolean(order) && !pickerOpen && !bigOrder} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md overflow-hidden" style={{ perspective: 900 }}>
        {custom ? (
          <motion.div
            key="custom"
            className="flex flex-col gap-4"
            initial={reduce ? false : { opacity: 0, x: 28, rotateY: -8 }}
            animate={{ opacity: 1, x: 0, rotateY: 0 }}
            transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 34 }}
          >
            <DialogHeader>
              <DialogTitle>Своя рулетка</DialogTitle>
              <DialogDescription>
                {order ? `${order.client} — отметьте, среди кого крутить. Отклик не обязателен; кого сегодня нет, выбрать нельзя.` : ""}
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-wrap gap-1.5">
              <Button
                size="sm"
                variant="outline"
                className="h-8"
                disabled={busy !== null}
                onClick={() => setCustom(initialCustom())}
              >
                Откликнувшиеся
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8"
                disabled={busy !== null}
                onClick={() => setCustom(new Set(candidates.filter(eligibleCustom).map((c) => c.uid)))}
              >
                Все на смене
              </Button>
              <Button size="sm" variant="ghost" className="h-8" disabled={busy !== null} onClick={() => setCustom(new Set())}>
                Снять
              </Button>
            </div>
            <div className="flex max-h-[50vh] flex-col gap-1.5 overflow-y-auto" data-custom-wheel>
              {candidates.map((c) => {
                const allowed = eligibleCustom(c);
                const on = allowed && custom.has(c.uid);
                const why = !c.hasDesk ? "стола нет" : c.absentToday ? (c.blockedReason ?? "сегодня нет") : null;
                return (
                  <button
                    key={c.uid}
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    disabled={!allowed || busy !== null}
                    onClick={() =>
                      setCustom((prev) => {
                        const next = new Set(prev ?? []);
                        if (next.has(c.uid)) next.delete(c.uid);
                        else next.add(c.uid);
                        return next;
                      })
                    }
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl border p-2.5 text-left transition-colors",
                      on ? "border-primary/40 bg-primary/[0.07]" : "border-border hover:bg-accent/40",
                      !allowed && "opacity-50"
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-5 w-5 shrink-0 items-center justify-center rounded border",
                        on ? "border-primary bg-primary text-primary-foreground" : "border-border"
                      )}
                    >
                      {on ? <Check className="h-3.5 w-3.5" /> : null}
                    </span>
                    <MemberAvatar id={c.uid} name={c.member.name} nickname={c.member.nickname} photoURL={c.member.photoURL} className="h-7 w-7 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-sm font-medium">{c.name}</span>
                        {allowed && c.blockedReason ? (
                          <span className="shrink-0 rounded-full border border-warning/40 bg-warning/10 px-1.5 text-[10px] leading-4 text-warning">
                            {c.blockedReason}
                          </span>
                        ) : null}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {why ?? c.deskName ?? ""}
                        {c.claimedAt != null ? " · откликнулся" : ""}
                      </p>
                    </div>
                    {on && chances?.has(c.uid) ? (
                      <span className="shrink-0 rounded-md border border-primary/30 bg-primary/10 px-1.5 font-mono text-[10.5px] leading-5 text-primary" title="Шанс — видит только Owner">
                        {chances.get(c.uid)} %
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" className="gap-1.5" disabled={busy !== null} onClick={() => setCustom(null)}>
                <ArrowLeft className="h-4 w-4" /> Назад
              </Button>
              <Button
                className="flex-1 gap-2"
                disabled={customUids.length < 2 || busy !== null}
                onClick={() => void run("__custom", () => onRandom({ uids: customUids }))}
              >
                {busy === "__custom" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Dices className="h-4 w-4" />}
                {customUids.length < 2 ? "Отметьте хотя бы двоих" : `Крутить · ${customUids.length}`}
              </Button>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="list"
            className="flex flex-col gap-4"
            initial={reduce ? false : { opacity: 0, x: -28, rotateY: 8 }}
            animate={{ opacity: 1, x: 0, rotateY: 0 }}
            transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 34 }}
          >
        <DialogHeader>
          <DialogTitle>Кому отдать заказ</DialogTitle>
          <DialogDescription>
            {order ? `${order.client} — можно отдать любому ${studio ? "менеджеру" : "технарю"} со столом, даже если он не откликался.` : ""}
          </DialogDescription>
        </DialogHeader>
        <RandomModeCards
          mode={mode}
          onMode={setMode}
          pools={pools}
          reasons={reasons}
          byUid={byUidAll}
          reduce={reduce}
          disabled={busy !== null}
        />
        <div className="flex gap-2">
          <motion.div className="flex-1" whileTap={reduce || randomPool.length === 0 ? undefined : { scale: 0.97 }}>
            <Button
              className="group w-full gap-2"
              data-random-spin
              disabled={randomPool.length === 0 || busy !== null}
              onClick={() => {
                if (!studio) rememberRandomMode(mode);
                void run("__random", () => onRandom({ mode }));
              }}
            >
              {busy === "__random" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Dices className="h-4 w-4 transition-transform duration-500 group-hover:rotate-[200deg]" />
              )}
              {randomPool.length > 0 ? `Крутить · ${randomPool.length}` : "Некого крутить"}
            </Button>
          </motion.div>
          <Button
            variant="outline"
            className="shrink-0 gap-1.5"
            disabled={busy !== null}
            title="Выбрать, среди кого крутить рулетку"
            onClick={() => setCustom(initialCustom())}
          >
            <Dices className="h-4 w-4" /> Своя рулетка
          </Button>
        </div>
        {candidates.length > 6 ? (
          <Button variant="outline" className="w-full gap-2" disabled={busy !== null} onClick={() => setPickerOpen(true)}>
            <Maximize2 className="h-4 w-4" />
            Все {studio ? t("technician").toLowerCase() : "технари"} на весь экран · поиск и сортировка
          </Button>
        ) : null}
        <div className="flex max-h-[55vh] flex-col gap-3 overflow-y-auto">
          {claimed.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Откликнулись · {claimed.length}</p>
              {claimed.map(row)}
            </div>
          )}
          {others.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {claimed.length ? "Отдать напрямую — без отклика" : studio ? t("technician") : "Технари"}
              </p>
              {others.map(row)}
            </div>
          )}
          {candidates.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">{studio ? "Менеджеров в workspace пока нет." : "Технарей в workspace пока нет."}</p>
          )}
        </div>
          </motion.div>
        )}
      </DialogContent>
    </Dialog>
    </>
  );
}

const CARD_SPRING = { type: "spring", stiffness: 460, damping: 32 } as const;

/**
 * Две карточки «Среди кого крутить»: откликнувшиеся / без заказов в работе.
 * Подсветка выбранной ПЕРЕЕЗЖАЕТ между карточками (`layoutId`), выбранная чуть
 * приподнимается, стопка аватаров пула перестраивается: ушедшие сжимаются,
 * новые вырастают.
 */
function RandomModeCards({
  mode,
  onMode,
  pools,
  reasons,
  byUid,
  reduce,
  disabled,
}: {
  mode: RandomMode;
  onMode: (mode: RandomMode) => void;
  pools: Record<RandomMode, OrderCandidate[]>;
  reasons: Record<RandomMode, string | null>;
  byUid: Map<string, OrderCandidate & { member: WorkspaceMember }>;
  reduce: boolean;
  disabled: boolean;
}) {
  const modes: RandomMode[] = ["claimed", "free"];
  return (
    <div className="flex flex-col gap-1.5" data-random-modes>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Рандом — среди кого крутить</p>
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Среди кого крутить «Рандом»">
        {modes.map((m) => {
          const pool = pools[m];
          const on = m === mode;
          const empty = pool.length === 0;
          const Icon = m === "claimed" ? Hand : Sparkles;
          const shown = pool.slice(0, 4);
          return (
            <motion.button
              key={m}
              type="button"
              role="radio"
              aria-checked={on}
              data-random-mode={m}
              disabled={disabled}
              onClick={() => onMode(m)}
              animate={reduce ? undefined : { scale: on ? 1.02 : 1, y: on ? -1 : 0 }}
              whileTap={reduce ? undefined : { scale: 0.97 }}
              transition={CARD_SPRING}
              className={cn(
                "relative flex min-h-[92px] flex-col items-start gap-1 overflow-hidden rounded-xl border p-2.5 text-left transition-colors",
                on ? "border-primary/50" : "border-border hover:border-primary/30",
                empty && !on && "opacity-60"
              )}
            >
              {on ? (
                <motion.span
                  layoutId={reduce ? undefined : "random-mode-glow"}
                  transition={CARD_SPRING}
                  aria-hidden
                  className="absolute inset-0 -z-0 bg-gradient-to-br from-primary/[0.16] via-primary/[0.06] to-transparent"
                />
              ) : null}
              <span className="relative z-10 flex w-full items-center gap-1.5">
                <motion.span
                  animate={reduce ? undefined : { rotate: on ? (m === "claimed" ? -12 : 18) : 0, scale: on ? 1.15 : 1 }}
                  transition={CARD_SPRING}
                  className={cn("grid h-5 w-5 place-items-center", on ? "text-primary" : "text-muted-foreground")}
                >
                  <Icon className="h-3.5 w-3.5" />
                </motion.span>
                <span className={cn("min-w-0 flex-1 truncate text-[13px] font-medium", on && "text-primary")}>
                  {RANDOM_MODE_LABELS[m].title}
                </span>
                <motion.span
                  key={pool.length}
                  initial={reduce ? false : { scale: 1.4, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={CARD_SPRING}
                  className={cn("font-mono text-[13px] tabular-nums", on ? "text-primary" : "text-muted-foreground")}
                >
                  {pool.length}
                </motion.span>
              </span>
              <span className="relative z-10 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                {empty ? reasons[m] : m === "claimed" ? "кто отозвался на заказ" : "со столом, на смене, без «в работе»"}
              </span>
              <span className="relative z-10 mt-auto flex h-6 items-center pl-1.5">
                {shown.map((c, i) => {
                    const member = byUid.get(c.uid)?.member;
                    return (
                      <motion.span
                        key={c.uid}
                        layout={!reduce}
                        initial={reduce ? false : { scale: 0, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ ...CARD_SPRING, delay: reduce ? 0 : i * 0.03 }}
                        className="-ml-1.5 rounded-full ring-2 ring-background"
                        data-pool-avatar
                        title={c.name}
                      >
                        <MemberAvatar
                          id={c.uid}
                          name={member?.name ?? c.name}
                          nickname={member?.nickname}
                          photoURL={member?.photoURL}
                          className="h-6 w-6"
                        />
                      </motion.span>
                    );
                  })}
                {pool.length > shown.length ? (
                  <span className="ml-1 font-mono text-[10.5px] text-muted-foreground">+{pool.length - shown.length}</span>
                ) : null}
              </span>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
