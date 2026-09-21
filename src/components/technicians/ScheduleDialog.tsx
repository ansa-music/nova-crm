import { useMemo, useState } from "react";
import { CalendarDays, Loader2 } from "lucide-react";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/utils/cn";
import { personLabel } from "@/utils/peopleDesks";
import { setScheduleDay, setSelfWorkDay } from "@/services/techScheduleService";
import {
  SCHEDULE_DAY_LABELS,
  scheduleStateOf,
  type ScheduleDayState,
  type TechSchedule,
  type WorkspaceMember,
} from "@/types";

const STATE_STYLE: Record<ScheduleDayState, string> = {
  work: "border-border/50 text-muted-foreground/70 hover:bg-accent/50",
  off: "border-destructive/45 bg-destructive/15 text-destructive",
  excused: "border-warning/45 bg-warning/15 text-warning",
};

/** Клик по дню перебирает состояния по кругу — отдельное меню на 31 клетку было бы пыткой. */
const NEXT_STATE: Record<ScheduleDayState, ScheduleDayState> = {
  work: "off",
  off: "excused",
  excused: "work",
};

/**
 * График технарей на месяц. Ведут его Тимлид и Owner — они же и просили:
 * выходной и «отпросился» ставит руководитель, а не сам человек.
 *
 * Технарь видит график всех (чтобы понимать, кто сегодня есть), но в своей
 * строке может ровно одно — нажать «Вышел на смену» на СЕГОДНЯ. Прошлые и
 * будущие дни он не трогает: задним числом переписывать график смысла нет,
 * а наперёд — это уже решение руководителя.
 */
export function ScheduleDialog({
  open,
  onOpenChange,
  workspaceId,
  monthKey,
  monthLabel,
  todayKey,
  technicians,
  schedules,
  canEdit,
  myUid,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  monthKey: string;
  monthLabel: string;
  /** Сегодняшний день месяца («21») по Алматы. */
  todayKey: string;
  technicians: WorkspaceMember[];
  schedules: TechSchedule[];
  /** Тимлид/Owner. */
  canEdit: boolean;
  myUid: string;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const byUid = useMemo(() => {
    const map = new Map<string, TechSchedule>();
    for (const s of schedules) map.set(s.uid, s);
    return map;
  }, [schedules]);

  const days = useMemo(() => {
    const [year, month] = monthKey.split("-").map(Number);
    const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return Array.from({ length: count }, (_, i) => String(i + 1));
  }, [monthKey]);

  async function cycleDay(member: WorkspaceMember, dayKey: string) {
    if (!canEdit) return;
    const current = scheduleStateOf(byUid.get(member.uid), dayKey);
    const key = `${member.uid}:${dayKey}`;
    setBusy(key);
    try {
      await setScheduleDay({
        workspaceId,
        uid: member.uid,
        monthKey,
        dayKey,
        state: NEXT_STATE[current],
        actorUid: myUid,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось изменить график");
    } finally {
      setBusy(null);
    }
  }

  async function goOnShift() {
    setBusy(`self:${todayKey}`);
    try {
      await setSelfWorkDay({ workspaceId, uid: myUid, monthKey, dayKey: todayKey, working: true });
      toast.success("Вы на смене — теперь можно откликаться на заказы");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось выйти на смену");
    } finally {
      setBusy(null);
    }
  }

  const mySchedule = byUid.get(myUid) ?? null;
  const myToday = scheduleStateOf(mySchedule, todayKey);
  const iAmTechnician = technicians.some((m) => m.uid === myUid);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 shrink-0 text-primary" />
            График · {monthLabel}
          </DialogTitle>
          <DialogDescription>
            {canEdit
              ? "Клик по дню: рабочий → выходной → отпросился → рабочий. В выходной технарь не может откликаться на заказы."
              : "Выходные и «отпросился» ставит Тимлид. В нерабочий день откликаться на заказы нельзя."}
          </DialogDescription>
        </DialogHeader>

        {iAmTechnician && myToday !== "work" && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-warning/35 bg-warning/[0.08] px-3 py-2">
            <p className="min-w-0 flex-1 text-[12px]">
              {myToday === "off" ? "Сегодня у вас выходной" : "Сегодня вы отпросились"} — отклики на заказы закрыты.
            </p>
            <Button size="sm" onClick={() => void goOnShift()} disabled={busy !== null}>
              {busy === `self:${todayKey}` && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Вышел на смену
            </Button>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-0 text-[11px]">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-background px-2 py-1 text-left font-medium text-muted-foreground">
                  Технарь
                </th>
                {days.map((d) => (
                  <th
                    key={d}
                    className={cn(
                      "w-5 px-0 py-1 text-center font-mono text-[10px] font-medium tabular-nums",
                      d === todayKey ? "text-primary" : "text-muted-foreground/70"
                    )}
                  >
                    {d}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {technicians.map((member) => {
                const schedule = byUid.get(member.uid) ?? null;
                return (
                  <tr key={member.uid}>
                    <td className="sticky left-0 z-10 bg-background py-0.5 pr-2">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <MemberAvatar
                          id={member.uid}
                          name={member.name}
                          nickname={member.nickname}
                          photoURL={member.photoURL}
                          className="h-5 w-5 shrink-0"
                        />
                        <span className="max-w-[7.5rem] truncate text-[12px]">{personLabel(member)}</span>
                      </span>
                    </td>
                    {days.map((d) => {
                      const state = scheduleStateOf(schedule, d);
                      const selfWork = Boolean(schedule?.selfWork?.[d]);
                      const key = `${member.uid}:${d}`;
                      return (
                        <td key={d} className="p-px text-center">
                          <button
                            type="button"
                            disabled={!canEdit || busy !== null}
                            onClick={() => void cycleDay(member, d)}
                            title={`${personLabel(member)} · ${d} — ${SCHEDULE_DAY_LABELS[state]}${
                              selfWork ? " (вышел на смену сам)" : ""
                            }`}
                            className={cn(
                              "h-5 w-5 rounded border text-[9px] font-semibold transition-colors",
                              STATE_STYLE[state],
                              d === todayKey && "ring-1 ring-primary/50",
                              canEdit ? "cursor-pointer" : "cursor-default"
                            )}
                          >
                            {busy === key ? "·" : state === "off" ? "В" : state === "excused" ? "О" : selfWork ? "✓" : ""}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {technicians.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">Технарей в workspace пока нет.</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className={cn("h-3.5 w-3.5 rounded border", STATE_STYLE.off)} /> Выходной
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className={cn("h-3.5 w-3.5 rounded border", STATE_STYLE.excused)} /> Отпросился
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="flex h-3.5 w-3.5 items-center justify-center rounded border border-border/50 text-[9px]">✓</span>
            Вышел на смену сам
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
