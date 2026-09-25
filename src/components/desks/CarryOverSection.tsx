import { useCallback, useRef, useState } from "react";
import { Loader2, MoveRight, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/ui/section";
import { toast } from "@/components/ui/sonner";
import { useCurrentPeriodKey, usePeriodSettings } from "@/hooks/useCurrentPeriodKey";
import { refreshDeskLoadFromRows } from "@/services/deskLoadService";
import { findMonthTab } from "@/services/monthTabService";
import { carryOverAll, carryOverRows, listCarryCandidates, type CarryAllReport, type CarryCandidates } from "@/services/rows/carryOver";
import { useSbBackend } from "@/services/sb/sbCollections";
import { fetchSubPages } from "@/services/subPageService";
import { confirmDialog } from "@/utils/appDialog";
import { carryDefaultIds } from "@/utils/carryOver";
import { DEFAULT_STATUS_OPTIONS } from "@/utils/columnOptions";
import { firestoreErrorText } from "@/utils/dbError";
import { formatCount } from "@/utils/format";
import { periodOfTabId, periodShortLabel, previousPeriodKey } from "@/utils/periods";
import { effectiveTechLoadKinds } from "@/utils/techLoad";
import type { SubPage, Workspace, WorkspaceMember, WorkspacePage } from "@/types";

type DeskCarryState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "noTab"; reason: string }
  | { status: "ok"; fromTab: SubPage; toTab: SubPage; candidates: CarryCandidates };

const CONCURRENCY = 4;

/**
 * «Правка столов» → перенос незавершённых заказов в новый период у столов
 * технарей (Owner). Счётчики читаются по кнопке — строки прошлых вкладок
 * всех столов не стоит перечитывать на каждый вход. Работает и в
 * Firestore-режиме, и в Supabase.
 */
export function CarryOverSection({
  workspaceId,
  desks,
  members,
  workspace,
  uid,
  disabled,
}: {
  workspaceId: string;
  desks: { page: WorkspacePage; name: string }[];
  members: WorkspaceMember[];
  workspace: Workspace | null;
  uid: string;
  disabled: boolean;
}) {
  const currentKey = useCurrentPeriodKey();
  const periods = usePeriodSettings();
  const prevKey = previousPeriodKey(currentKey, periods);
  const fromLabel = periodShortLabel(prevKey, periods);
  const toLabel = periodShortLabel(currentKey, periods);
  const statusOptions = workspace?.statusOptions ?? DEFAULT_STATUS_OPTIONS;
  const kinds = effectiveTechLoadKinds(workspace);
  const responsibleOptions = workspace?.responsibleOptions ?? [];
  const deskLoadBackend = useSbBackend(workspace, "deskLoads");

  const [states, setStates] = useState<Map<string, DeskCarryState>>(new Map());
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [report, setReport] = useState<CarryAllReport | null>(null);
  const desksRef = useRef(desks);
  desksRef.current = desks;

  const count = useCallback(
    async (onlyPageIds?: string[]) => {
      const targets = desksRef.current.filter((d) => !onlyPageIds || onlyPageIds.includes(d.page.id));
      setStates((prev) => {
        const next = new Map(prev);
        for (const d of targets) next.set(d.page.id, { status: "loading" });
        return next;
      });
      let cursor = 0;
      const worker = async () => {
        while (cursor < targets.length) {
          const d = targets[cursor++];
          let state: DeskCarryState;
          try {
            const subs = await fetchSubPages(workspaceId, d.page.id);
            const toTab = findMonthTab(subs, currentKey);
            const fromTab = findMonthTab(subs, prevKey);
            if (!toTab || toTab.isArchived) state = { status: "noTab", reason: `нет вкладки «${toLabel}»` };
            else if (!fromTab || fromTab.isArchived) state = { status: "noTab", reason: `нет вкладки «${fromLabel}»` };
            else if (fromTab.id === toTab.id) state = { status: "noTab", reason: "одна вкладка на оба периода" };
            else {
              const candidates = await listCarryCandidates({ workspaceId, page: d.page, fromTab, statusOptions, kinds, force: true });
              state = { status: "ok", fromTab, toTab, candidates };
            }
          } catch (error) {
            state = { status: "error", message: error instanceof Error ? error.message : String(error) };
          }
          setStates((prev) => new Map(prev).set(d.page.id, state));
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));
    },
    [workspaceId, currentKey, prevKey, toLabel, fromLabel, statusOptions, kinds]
  );

  async function carryDesk(d: { page: WorkspacePage; name: string }) {
    const state = states.get(d.page.id);
    if (!state || state.status !== "ok") return;
    const ids = carryDefaultIds(state.candidates.groups);
    const rows = state.candidates.all.filter((r) => ids.has(r.id));
    if (rows.length === 0) return;
    const ok = await confirmDialog({
      title: `Перенести незавершённые «${d.name}»?`,
      description: `${formatCount(rows.length, ["заказ", "заказа", "заказов"])} в работе из «${fromLabel}» переедут в «${toLabel}». «Ждём оплату», «Готово» и «Отменено» остаются в прошлом периоде.`,
      confirmLabel: "Перенести",
    });
    if (!ok) return;
    setBusy(d.page.id);
    try {
      const result = await carryOverRows({
        workspaceId,
        page: d.page,
        fromTab: state.fromTab,
        toTab: state.toTab,
        rows,
        allFromRows: state.candidates.all,
        oldPeriodKey: periodOfTabId(state.fromTab.id) ?? state.fromTab.monthKey ?? prevKey,
        responsibleOptions,
        uid,
        deskLoadBackend,
      });
      if (result.moved.length > 0 && deskLoadBackend) {
        await refreshDeskLoadFromRows(d.page, currentKey, uid, undefined, [...responsibleOptions], deskLoadBackend).catch(() => false);
      }
      toast.success(
        result.moved.length ? `${d.name}: перенесено ${formatCount(result.moved.length, ["заказ", "заказа", "заказов"])}` : `${d.name}: переносить нечего`,
        { description: result.skipped.length ? `Уже были там: ${result.skipped.length}` : undefined }
      );
    } catch (error) {
      toast.error(firestoreErrorText(error, "Не удалось перенести"));
    } finally {
      setBusy(null);
      void count([d.page.id]);
    }
  }

  async function carryAll() {
    const ok = await confirmDialog({
      title: "Перенести незавершённые у ВСЕХ технарей?",
      description: `У каждого стола технаря заказы в работе из «${fromLabel}» переедут во вкладку «${toLabel}» (обе вкладки должны уже быть). «Ждём оплату», «Готово» и «Отменено» остаются. Повтор ничего не размножает.`,
      confirmLabel: "Перенести у всех",
    });
    if (!ok) return;
    setBusy("__all");
    setReport(null);
    try {
      const result = await carryOverAll({
        workspaceId,
        members,
        currentKey,
        statusOptions,
        kinds,
        responsibleOptions,
        uid,
        deskLoadBackend,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      setReport(result);
      if (result.errors.length) toast.error("Перенесено с ошибками — подробности ниже");
      else toast.success(`Перенесено: ${result.moved}`);
    } catch (error) {
      toast.error(firestoreErrorText(error, "Не удалось перенести"));
    } finally {
      setProgress(null);
      setBusy(null);
      void count();
    }
  }

  const locked = disabled || busy !== null;
  const counted = states.size > 0;

  return (
    <Section
      eyebrow="Для всех"
      title={`Перенос незавершённых: «${fromLabel}» → «${toLabel}»`}
      padded={false}
      action={
        <Button variant="ghost" size="sm" className="min-h-11 gap-1.5 sm:min-h-0" onClick={() => void count()} disabled={locked}>
          <RefreshCw className="h-3.5 w-3.5" /> {counted ? "Пересчитать" : "Посчитать"}
        </Button>
      }
    >
      <p className="border-b border-border px-4 py-3 text-xs leading-5 text-muted-foreground">
        Заказы в работе переезжают во вкладку нового периода целиком (визитка, файлы, оценка); прошлый период их считать
        перестаёт, а его архив пересчитывается по оставшимся. Технарь видит ту же плашку на своём столе и переносит сам;
        здесь — за него. «Ждём оплату» переносится только вручную со стола.
      </p>
      {counted && (
        <ul className="divide-y divide-border">
          {desks.map((d) => {
            const state = states.get(d.page.id);
            let text: React.ReactNode = "—";
            let canCarry = false;
            if (state?.status === "loading") text = <Loader2 className="h-3.5 w-3.5 animate-spin" />;
            else if (state?.status === "error") text = <span className="text-destructive">{state.message}</span>;
            else if (state?.status === "noTab") text = state.reason;
            else if (state?.status === "ok") {
              const g = state.candidates.groups;
              canCarry = g.unfinished.length > 0;
              text = (
                <>
                  в работе: <span className={canCarry ? "font-medium text-foreground" : ""}>{g.unfinished.length}</span>
                  {g.payment.length > 0 && <> · ждут оплату: {g.payment.length}</>}
                  {g.unfinished.length + g.payment.length === 0 && <> · переносить нечего</>}
                </>
              );
            }
            return (
              <li key={d.page.id} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3">
                <span className="min-w-0 flex-1 truncate text-sm">{d.name}</span>
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">{text}</span>
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-11 gap-1.5 sm:min-h-0"
                  disabled={locked || !canCarry}
                  onClick={() => void carryDesk(d)}
                >
                  {busy === d.page.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MoveRight className="h-3.5 w-3.5" />}
                  Перенести
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <Button className="min-h-11 gap-1.5 sm:min-h-0" onClick={() => void carryAll()} disabled={locked}>
          {busy === "__all" ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoveRight className="h-4 w-4" />}
          Перенести у всех
        </Button>
        {progress && (
          <span className="text-sm text-muted-foreground">
            {progress.done} / {progress.total}
          </span>
        )}
        {report && (
          <span className="text-sm text-muted-foreground">
            Перенесено: <span className="font-medium text-foreground">{report.moved}</span> · столов: {report.desks} · без
            вкладки периода: {report.noTab}
            {report.skipped > 0 && <> · уже были там: {report.skipped}</>}
            {report.errors.map((e, i) => (
              <span key={i} className="block text-destructive">
                {e}
              </span>
            ))}
          </span>
        )}
      </div>
    </Section>
  );
}
