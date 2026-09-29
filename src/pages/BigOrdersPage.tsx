import { useMemo, useState, type ReactNode } from "react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  ChevronsUp,
  Crown,
  GripVertical,
  Loader2,
  Pause,
  Play,
  Plus,
  Search,
  Settings2,
  Trash2,
  UserCog,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { AccessDenied } from "@/components/common/AccessDenied";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { PageHeader } from "@/components/common/PageHeader";
import { GrokPeoplePicker, GrokPickerShell } from "@/components/grok/GrokPeoplePicker";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Section } from "@/components/ui/section";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspace } from "@/hooks/useWorkspace";
import {
  canManageBigQueue,
  DEFAULT_BIG_THRESHOLD,
  saveBigConfig,
  saveBigLists,
  setBigQueueEnabled,
  shortMoney,
  useBigOrderQueue,
  type BigQueueConfig,
} from "@/services/bigOrderQueueService";
import { cn } from "@/utils/cn";
import { ymdInTimeZone, zonedDateFormat } from "@/utils/date";
import { currencySymbol, formatNumber } from "@/utils/format";
import { personLabel, worksAsTechnician } from "@/utils/peopleDesks";
import type { WorkspaceMember } from "@/types";

const timeFormat = () => zonedDateFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const clockFormat = () => zonedDateFormat("ru-RU", { hour: "2-digit", minute: "2-digit" });

const POINTER_SENSOR_OPTIONS = { activationConstraint: { distance: 5 } };
const KEYBOARD_SENSOR_OPTIONS = { coordinateGetter: sortableKeyboardCoordinates };
/** Id самих списков — чтобы бросить человека и в пустой список. */
const QUEUE_ZONE = "zone:queue";
const POOL_ZONE = "zone:pool";

type Lists = { queue: string[]; pool: string[] };
type ListKey = keyof Lists;

function listOf(id: UniqueIdentifier, lists: Lists): ListKey | null {
  if (id === QUEUE_ZONE) return "queue";
  if (id === POOL_ZONE) return "pool";
  const uid = String(id);
  if (lists.queue.includes(uid)) return "queue";
  if (lists.pool.includes(uid)) return "pool";
  return null;
}

/** «получил заказ сегодня 14:05» / «получил заказ 28 сент., 14:05». */
function takenLabel(at: number, now = Date.now()): string {
  return ymdInTimeZone(at) === ymdInTimeZone(now)
    ? `получил заказ сегодня ${clockFormat().format(at)}`
    : `получил заказ ${timeFormat().format(at)}`;
}

/** Строка очереди или группы, которую можно тащить за ручку (мышью, пальцем или клавишами). */
function SortableItem({
  id,
  children,
}: {
  id: string;
  children: (handle: ReactNode) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  const handle = (
    <button
      type="button"
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
      aria-label="Перетащить"
      title="Перетащить: поменять место или перенести между очередью и группой"
      className="flex h-11 w-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground/70 hover:bg-accent hover:text-foreground active:cursor-grabbing sm:h-9 sm:w-6"
    >
      <GripVertical className="h-4 w-4" />
    </button>
  );
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("relative flex flex-col bg-card", isDragging && "z-10 shadow-lg ring-1 ring-primary/40")}
    >
      {children(handle)}
    </li>
  );
}

/** Список, в который можно бросить человека, даже пустой. */
function DropList({ id, empty, children }: { id: string; empty: ReactNode; children: ReactNode[] }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={cn("transition-colors", isOver && children.length === 0 && "bg-primary/[0.06]")}>
      {children.length === 0 ? empty : <ol className="flex flex-col divide-y divide-border">{children}</ol>}
    </div>
  );
}

/**
 * «Заказы от 300к+» (просьба Nurba 28.09.2026). Owner назначает ответственных
 * и порог суммы чека, ответственный расставляет очередь технарей: №1 в
 * приоритете. Заказ с чеком от порога ОС отдаёт только технарю из очереди —
 * окно выдачи само открывается на очереди, выходные и занятость не мешают.
 */
export default function BigOrdersPage() {
  const permissions = usePermissions();
  const { profile } = useAuth();
  const { activeWorkspace, activeWorkspaceId, members } = useWorkspace();
  const supabaseRows = activeWorkspace?.rowsBackend === "supabase";
  const snap = useBigOrderQueue(activeWorkspaceId, Boolean(supabaseRows));
  const isOwner = permissions.isResolved && permissions.actsAsOwner;
  const cfg = snap.data;
  const canManage = canManageBigQueue(profile?.uid, cfg, isOwner);

  if (!permissions.isResolved || !activeWorkspace || (supabaseRows && (snap.status === "idle" || snap.status === "loading"))) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 sm:p-8">
        <Skeleton className="h-8 w-60" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
    );
  }
  if (!supabaseRows) {
    return (
      <div className="mx-auto w-full max-w-3xl p-4 sm:p-8">
        <Alert tone="warning">Очередь крупных заказов работает, когда строки таблиц хранятся в Supabase («Настройки → Строки таблиц»).</Alert>
      </div>
    );
  }
  if (snap.status === "missing") {
    return (
      <div className="mx-auto w-full max-w-3xl p-4 sm:p-8">
        <Alert tone="warning">Очередь ещё не включена в базе — Owner должен обновить SQL (плашка сверху).</Alert>
      </div>
    );
  }
  if (!canManage) {
    return <AccessDenied reason="Очередь крупных заказов ведут ответственные, которых назначил Owner." />;
  }
  if (!cfg || !activeWorkspaceId) {
    return (
      <div className="mx-auto w-full max-w-3xl p-4 sm:p-8">
        <Alert tone="error">Не удалось прочитать очередь. Обновите страницу.</Alert>
      </div>
    );
  }
  return <BigOrdersBody ws={activeWorkspaceId} cfg={cfg} members={members} isOwner={isOwner} />;
}

function BigOrdersBody({
  ws,
  cfg,
  members,
  isOwner,
}: {
  ws: string;
  cfg: BigQueueConfig;
  members: WorkspaceMember[];
  isOwner: boolean;
}) {
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [managersOpen, setManagersOpen] = useState(false);
  const [thresholdDraft, setThresholdDraft] = useState<string | null>(null);
  // Пока тащат — черновик обоих списков: человек «переезжает» между ними на глазах.
  const [drag, setDrag] = useState<Lists | null>(null);
  const now = Date.now();

  const byUid = useMemo(() => new Map(members.map((m) => [m.uid, m])), [members]);
  const active = useMemo(() => members.filter((m) => m.status === "active" && m.uid), [members]);
  const lists: Lists = drag ?? { queue: cfg.queue, pool: cfg.pool };
  const candidates = useMemo(() => {
    const listed = new Set([...cfg.queue, ...cfg.pool]);
    const q = query.trim().toLocaleLowerCase("ru");
    return active
      .filter((m) => worksAsTechnician(m) && !listed.has(m.uid))
      .filter((m) => !q || `${personLabel(m)} ${m.name ?? ""} ${m.techNickValue ?? ""}`.toLocaleLowerCase("ru").includes(q))
      .sort((a, b) => personLabel(a).localeCompare(personLabel(b), "ru"));
  }, [active, cfg.queue, cfg.pool, query]);
  const sensors = useSensors(useSensor(PointerSensor, POINTER_SENSOR_OPTIONS), useSensor(KeyboardSensor, KEYBOARD_SENSOR_OPTIONS));

  async function writeLists(nextQueue: string[], nextPool: string[] = cfg.pool) {
    if (nextQueue.join("\u0001") === cfg.queue.join("\u0001") && nextPool.join("\u0001") === cfg.pool.join("\u0001")) return;
    setSaving(true);
    try {
      await saveBigLists(ws, nextQueue, nextPool);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить очередь");
    } finally {
      setSaving(false);
    }
  }
  const without = (list: string[], uid: string) => list.filter((u) => u !== uid);
  const toGroup = (uid: string) => writeLists(without(cfg.queue, uid), [uid, ...without(cfg.pool, uid)]);
  const toQueueEnd = (uid: string) => writeLists([...without(cfg.queue, uid), uid], without(cfg.pool, uid));
  const toQueueFirst = (uid: string) => writeLists([uid, ...without(cfg.queue, uid)], without(cfg.pool, uid));
  const allToQueue = () => writeLists([...cfg.queue, ...cfg.pool], []);
  const dropFromGroup = (uid: string) => writeLists(cfg.queue, without(cfg.pool, uid));

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= cfg.queue.length) return;
    void writeLists(arrayMove(cfg.queue, index, target));
  }

  function onDragOver({ active: dragged, over }: DragOverEvent) {
    if (!over) return;
    setDrag((prev) => {
      const base = prev ?? { queue: cfg.queue, pool: cfg.pool };
      const from = listOf(dragged.id, base);
      const to = listOf(over.id, base);
      if (!from || !to || from === to) return prev ?? base;
      const uid = String(dragged.id);
      const target = base[to];
      const at = target.indexOf(String(over.id));
      const nextTarget = [...target];
      nextTarget.splice(at < 0 ? target.length : at, 0, uid);
      return { ...base, [from]: without(base[from], uid), [to]: nextTarget } as Lists;
    });
  }

  function onDragEnd({ active: dragged, over }: DragEndEvent) {
    const base = drag ?? { queue: cfg.queue, pool: cfg.pool };
    setDrag(null);
    if (!over) return;
    const key = listOf(dragged.id, base);
    if (!key) return;
    let next = base;
    if (listOf(over.id, base) === key) {
      const from = base[key].indexOf(String(dragged.id));
      const to = base[key].indexOf(String(over.id));
      if (from >= 0 && to >= 0 && from !== to) next = { ...base, [key]: arrayMove(base[key], from, to) } as Lists;
    }
    void writeLists(next.queue, next.pool);
  }

  async function writeEnabled(on: boolean) {
    setSaving(true);
    try {
      await setBigQueueEnabled(ws, on);
      toast.success(on ? "Очередь снова работает" : "Очередь на паузе — крупные заказы выдаются как обычно");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось переключить очередь");
    } finally {
      setSaving(false);
    }
  }

  async function saveThreshold() {
    const value = Math.round(Number(String(thresholdDraft ?? "").replace(/[^\d]/g, "")));
    if (!Number.isFinite(value) || value < 1000) {
      toast.error("Порог — от 1 000");
      return;
    }
    try {
      await saveBigConfig(ws, cfg.managers, value);
      setThresholdDraft(null);
      toast.success(`Порог: ${formatNumber(value)} ${currencySymbol()}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить порог");
    }
  }

  const managerNames = cfg.managers.map((uid) => {
    const m = byUid.get(uid);
    return m ? personLabel(m) : "ушёл из команды";
  });
  const updatedBy = cfg.updatedBy ? byUid.get(cfg.updatedBy) : null;
  const pausedBy = cfg.pausedBy ? byUid.get(cfg.pausedBy) : null;
  const nameOf = (uid: string) => {
    const member = byUid.get(uid) ?? null;
    return { member, name: member ? personLabel(member) : "ушёл из команды" };
  };
  const iconBtn = "h-11 w-11 sm:h-8 sm:w-8";

  function personBlock(uid: string, extra: ReactNode) {
    const { member, name } = nameOf(uid);
    return (
      <>
        <MemberAvatar id={uid} name={name} photoURL={member?.photoURL} className="h-8 w-8 shrink-0" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
            <span className="truncate text-sm font-medium">{name}</span>
            {extra}
          </span>
          {member && member.name && member.name !== name ? (
            <span className="truncate text-[11.5px] text-muted-foreground">{member.name}</span>
          ) : null}
        </span>
      </>
    );
  }

  const queueRows = lists.queue.map((uid, i) => {
    const top = cfg.enabled && i === 0;
    const { name } = nameOf(uid);
    return (
      <SortableItem key={uid} id={uid}>
        {(handle) => (
          <div
            className={cn(
              "flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 sm:flex-nowrap sm:px-4",
              top && "bg-warning/[0.06]"
            )}
          >
            {handle}
            <span
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg font-mono text-sm font-semibold tabular-nums",
                top ? "bg-warning/20 text-warning" : "bg-muted text-muted-foreground"
              )}
              aria-label={`№${i + 1}`}
            >
              {i + 1}
            </span>
            {personBlock(
              uid,
              top ? (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning">
                  <Crown className="h-3 w-3" /> в приоритете
                </span>
              ) : null
            )}
            <span className="flex w-full shrink-0 items-center justify-end gap-0.5 sm:w-auto">
              <Button
                variant="ghost"
                size="icon"
                data-compact
                className={cn(iconBtn, i === 0 && "invisible")}
                aria-label={`${name} — первым`}
                title="Поставить первым"
                disabled={i === 0 || saving || drag !== null}
                onClick={() => void toQueueFirst(uid)}
              >
                <ChevronsUp className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                data-compact
                className={iconBtn}
                aria-label="Выше"
                disabled={i === 0 || saving || drag !== null}
                onClick={() => move(i, -1)}
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                data-compact
                className={iconBtn}
                aria-label="Ниже"
                disabled={i === lists.queue.length - 1 || saving || drag !== null}
                onClick={() => move(i, 1)}
              >
                <ArrowDown className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="min-h-11 gap-1 px-2 text-muted-foreground sm:min-h-8"
                aria-label={`${name} — в группу`}
                title="Убрать из очереди в группу — вернуть можно одной кнопкой"
                disabled={saving || drag !== null}
                onClick={() => void toGroup(uid)}
              >
                <ArrowDownToLine className="h-4 w-4" />
                <span>В группу</span>
              </Button>
            </span>
          </div>
        )}
      </SortableItem>
    );
  });

  const poolRows = lists.pool.map((uid) => {
    const { name } = nameOf(uid);
    const took = cfg.taken[uid];
    return (
      <SortableItem key={uid} id={uid}>
        {(handle) => (
          <div className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 sm:flex-nowrap sm:px-4">
            {handle}
            {personBlock(
              uid,
              took ? (
                <span className="inline-flex shrink-0 items-center rounded-full bg-success/15 px-1.5 py-0.5 text-[10px] font-medium text-success">
                  {takenLabel(took, now)}
                </span>
              ) : null
            )}
            <span className="flex w-full shrink-0 items-center justify-end gap-0.5 sm:w-auto">
              <Button
                variant="ghost"
                size="icon"
                data-compact
                className={iconBtn}
                aria-label={`${name} — первым в очередь`}
                title="Первым в очередь"
                disabled={saving || drag !== null}
                onClick={() => void toQueueFirst(uid)}
              >
                <ChevronsUp className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="min-h-11 shrink-0 gap-1 px-2.5 sm:min-h-8"
                disabled={saving || drag !== null}
                onClick={() => void toQueueEnd(uid)}
                aria-label={`${name} — в очередь`}
                title="В конец очереди"
              >
                <ArrowUpToLine className="h-3.5 w-3.5" /> В очередь
              </Button>
              <Button
                variant="ghost"
                size="icon"
                data-compact
                className={cn(iconBtn, "shrink-0 text-muted-foreground hover:text-destructive")}
                aria-label={`${name} — удалить из группы`}
                title="Удалить из группы совсем"
                disabled={saving || drag !== null}
                onClick={() => void dropFromGroup(uid)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </span>
          </div>
        )}
      </SortableItem>
    );
  });

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-4 p-4 sm:p-6">
      <PageHeader
        className="mb-0"
        eyebrow="Очередь технарей"
        title={`Заказы от ${shortMoney(cfg.threshold)}+`}
        description={`Заказ с чеком (цена + апсейл) от ${formatNumber(cfg.threshold)} ${currencySymbol()} ОС отдаёт только технарю из этой очереди: окно выдачи открывается на ней само. №1 — в приоритете; получивший заказ сам уходит из очереди в группу. Выходные и занятость на эту выдачу не действуют.`}
      />

      <div
        className={cn(
          "flex items-center gap-3 rounded-xl border px-4 py-3",
          cfg.enabled ? "border-border bg-card" : "border-warning/40 bg-warning/[0.08]"
        )}
      >
        <span
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
            cfg.enabled ? "bg-success/15 text-success" : "bg-warning/20 text-warning"
          )}
        >
          {cfg.enabled ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-medium">{cfg.enabled ? "Очередь работает" : "Очередь на паузе"}</span>
          <span className="text-[12px] text-muted-foreground">
            {cfg.enabled
              ? "Заказ от порога ОС отдаёт только технарю из очереди."
              : `Крупные заказы сейчас выдаются как обычно. Очередь и номера сохранены${pausedBy ? ` · поставил(а) ${personLabel(pausedBy)}` : ""}.`}
          </span>
        </span>
        <Switch
          checked={cfg.enabled}
          disabled={saving}
          onCheckedChange={(on) => void writeEnabled(on)}
          aria-label={cfg.enabled ? "Поставить очередь на паузу" : "Включить очередь"}
        />
      </div>

      {isOwner ? (
        <Section eyebrow="Только Owner" title="Настройка">
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-full text-[12px] text-muted-foreground sm:w-auto">Ответственные:</span>
              {managerNames.length ? (
                managerNames.map((name, i) => (
                  <span key={cfg.managers[i]} className="rounded-full border border-border bg-muted/40 px-2.5 py-1 text-[12.5px]">
                    {name}
                  </span>
                ))
              ) : (
                <span className="text-[12.5px] text-muted-foreground">никого — очередь ведёт только Owner</span>
              )}
              <Button variant="outline" size="sm" className="min-h-11 gap-1.5 sm:min-h-8" onClick={() => setManagersOpen(true)}>
                <UserCog className="h-3.5 w-3.5" /> Изменить
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-full text-[12px] text-muted-foreground sm:w-auto">Порог суммы чека:</span>
              <div className="relative w-40">
                <Input
                  value={thresholdDraft ?? formatNumber(cfg.threshold)}
                  onChange={(e) => setThresholdDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void saveThreshold();
                    if (e.key === "Escape") setThresholdDraft(null);
                  }}
                  inputMode="numeric"
                  aria-label="Порог суммы чека"
                  className="pr-7 font-mono tabular-nums"
                />
                <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  {currencySymbol()}
                </span>
              </div>
              {thresholdDraft !== null ? (
                <>
                  <Button size="sm" className="min-h-11 sm:min-h-8" onClick={() => void saveThreshold()}>
                    Сохранить
                  </Button>
                  <Button size="sm" variant="ghost" className="min-h-11 sm:min-h-8" onClick={() => setThresholdDraft(null)}>
                    Отмена
                  </Button>
                </>
              ) : cfg.threshold !== DEFAULT_BIG_THRESHOLD ? (
                <span className="text-[11.5px] text-muted-foreground">по умолчанию {formatNumber(DEFAULT_BIG_THRESHOLD)}</span>
              ) : null}
            </div>
          </div>
        </Section>
      ) : null}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={() => setDrag({ queue: cfg.queue, pool: cfg.pool })}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDrag(null)}
      >
      <Section
        eyebrow={`в очереди ${lists.queue.length}`}
        title="Активная очередь"
        action={
          <span className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
            {saving ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Сохраняю…
              </>
            ) : cfg.updatedAt ? (
              <>Сохранено · {timeFormat().format(cfg.updatedAt)}{updatedBy ? ` · ${personLabel(updatedBy)}` : ""}</>
            ) : null}
          </span>
        }
        padded={false}
      >
        <SortableContext items={lists.queue} strategy={verticalListSortingStrategy}>
          <DropList
            id={QUEUE_ZONE}
            empty={
              <p className="px-4 py-6 text-sm text-muted-foreground">
                Очередь пуста — крупные заказы выдаются как обычно. Верните людей из группы ниже (или перетащите сюда)
                или добавьте технаря.
              </p>
            }
          >
            {queueRows}
          </DropList>
        </SortableContext>

        <div className="border-t border-border px-3 py-3 sm:px-4">
          {adding ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        setAdding(false);
                        setQuery("");
                      }
                      if (e.key === "Enter" && candidates.length === 1) {
                        void toQueueEnd(candidates[0].uid);
                        setQuery("");
                      }
                    }}
                    placeholder="Найти технаря"
                    className="pl-8"
                    aria-label="Найти технаря"
                  />
                </div>
                <Button variant="ghost" className="min-h-11 sm:min-h-9" onClick={() => { setAdding(false); setQuery(""); }}>
                  Готово
                </Button>
              </div>
              {candidates.length === 0 ? (
                <p className="py-2 text-[12.5px] text-muted-foreground">
                  {query ? "Никого не нашёл." : "Все технари уже в очереди или в группе."}
                </p>
              ) : (
                <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
                  {candidates.map((m) => (
                    <li key={m.uid} className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => void toQueueEnd(m.uid)}
                        title="Добавить в конец очереди"
                        className="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 text-left hover:bg-accent/60 disabled:opacity-60"
                      >
                        <MemberAvatar id={m.uid} name={personLabel(m)} photoURL={m.photoURL} className="h-7 w-7 shrink-0" />
                        <span className="min-w-0 flex-1 truncate text-sm">{personLabel(m)}</span>
                        <span className="flex shrink-0 items-center gap-1 text-[12px] text-muted-foreground">
                          <Plus className="h-4 w-4" /> в очередь
                        </span>
                      </button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="min-h-11 shrink-0 gap-1 px-2 text-[12px] text-muted-foreground sm:min-h-9"
                        disabled={saving}
                        onClick={() => void writeLists(cfg.queue, [...cfg.pool, m.uid])}
                        aria-label={`${personLabel(m)} — в группу`}
                        title="Отобрать в группу, в очередь пока не ставить"
                      >
                        <Users className="h-3.5 w-3.5" /> в группу
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <Button variant="outline" className="min-h-11 gap-1.5 sm:min-h-9" onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" /> Добавить технаря
            </Button>
          )}
        </div>
      </Section>

      <Section
        eyebrow={`не в очереди · ${lists.pool.length}`}
        title="Группа"
        action={
          lists.pool.length > 1 ? (
            <Button variant="outline" size="sm" className="min-h-11 gap-1.5 sm:min-h-8" disabled={saving || drag !== null} onClick={() => void allToQueue()}>
              <ArrowUpToLine className="h-3.5 w-3.5" /> Все в очередь
            </Button>
          ) : null
        }
        padded={false}
      >
        <SortableContext items={lists.pool} strategy={verticalListSortingStrategy}>
          <DropList
            id={POOL_ZONE}
            empty={
              <p className="px-4 py-5 text-[12.5px] text-muted-foreground">
                Здесь те, кого вы отобрали, но кто сейчас не стоит в очереди. Получивший крупный заказ попадает сюда сам;
                «В очередь» или перетаскивание возвращают его.
              </p>
            }
          >
            {poolRows}
          </DropList>
        </SortableContext>
      </Section>
      </DndContext>

      <p className="flex items-start gap-2 text-[12px] text-muted-foreground">
        <Settings2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Очередь видят все, кто выдаёт заказы: полосой над выбором технаря, а у заказа от порога — вместо обычного списка.
        Менять можно в любое время — окна выдачи подхватят сразу. Порядок — перетаскиванием за ручку (и между очередью и
        группой), стрелками или «Первым». Технарь, получивший крупный заказ, сам уходит из очереди в начало группы —
        вернуть одной кнопкой «В очередь».
      </p>

      {managersOpen ? (
        <ManagersPicker
          candidates={active}
          initial={cfg.managers}
          onClose={() => setManagersOpen(false)}
          onSave={async (uids) => {
            await saveBigConfig(ws, uids, cfg.threshold);
            toast.success(uids.length ? `Ответственных: ${uids.length}` : "Ответственных нет — очередь ведёт Owner");
          }}
        />
      ) : null}
    </div>
  );
}

function ManagersPicker({
  candidates,
  initial,
  onClose,
  onSave,
}: {
  candidates: WorkspaceMember[];
  initial: string[];
  onClose: () => void;
  onSave: (uids: string[]) => Promise<void>;
}) {
  const known = useMemo(() => new Set(candidates.map((m) => m.uid)), [candidates]);
  const [selected, setSelected] = useState(() => initial.filter((u) => known.has(u)));
  const [busy, setBusy] = useState(false);
  return (
    <GrokPickerShell
      icon={<UserCog className="h-4 w-4 text-primary" />}
      title="Ответственные за очередь"
      description="Не роль, а доп. право: ответственный ведёт очередь крупных заказов. Роль человека не меняется."
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} className="ml-auto">
            Отмена
          </Button>
          <Button
            disabled={busy || selected.length > 10}
            onClick={async () => {
              setBusy(true);
              try {
                await onSave(selected);
                onClose();
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "Не удалось сохранить");
              } finally {
                setBusy(false);
              }
            }}
          >
            Сохранить · {selected.length}
          </Button>
        </>
      }
    >
      <GrokPeoplePicker candidates={candidates} selected={selected} onChange={setSelected} />
    </GrokPickerShell>
  );
}
