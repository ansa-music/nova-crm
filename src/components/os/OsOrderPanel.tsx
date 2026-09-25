import { useEffect, useState } from "react";
import { ArrowDownToLine, Hand, Loader2, RefreshCw, Send, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/table/StatusBadge";
import { CellActionButton } from "@/components/table/CellActionButton";
import { OsTechLeftView, TechBadge } from "@/components/os/TechBadge";
import { toast } from "@/components/ui/sonner";
import { useWorkspace } from "@/hooks/useWorkspace";
import {
  OS_DESK_KEYS,
  OS_RETURNED_REISSUE_ERROR,
  pushOsRowToTech,
  returnedRowOnTechDesk,
  type OsDeskKeys,
} from "@/services/osDeskService";
import { techTargetProblem, techUidByNick } from "@/services/rows/osOrderMirror";
import { DEFAULT_STATUS_OPTIONS, ensureApprovalStatus, ensureDoneStatus, isDoneStatusLabel } from "@/utils/columnOptions";
import { OsOrderRating } from "@/components/os/OsOrderRating";
import { firestoreErrorText } from "@/utils/dbError";
import { resolveTechIdentity } from "@/utils/techIdentity";
import { OS_DEAD_LINK_PROBLEM, type OsTechAction, type OsTechCellState } from "@/utils/osTechCell";
import type { PageRow, PaymentMethod } from "@/types";
import { PaymentChip } from "@/components/cashbox/PaymentChip";
import { osRowFees, osRowTotal } from "@/utils/payment";
import { formatCurrency } from "@/utils/format";
import { parseLooseNumber } from "@/utils/numberInput";
import type { OsDateSlot } from "@/utils/osDates";
import { OsDateButton, type OsDateSetter, type OsDatesInfo } from "@/components/os/OsDatesCell";

/** Сумма из ячейки как число (для показа рядом со способом оплаты). */
function cellAmount(value: unknown): number {
  if (typeof value === "number") return value;
  return parseLooseNumber(String(value ?? "")) ?? 0;
}

function cellText(row: PageRow, key: string | null | undefined): string {
  const v = key ? row.cells[key] : null;
  return v === null || v === undefined ? "" : String(v).trim();
}

/**
 * Сумма в «Кассе» карточки — нажал и правишь (просьба Nurba 25.09.2026:
 * «тут надо, чтобы можно было изменять суммы»). Enter или уход с поля —
 * запись, Esc — отмена; пусто — сумма стирается. Пока идёт запись, поле
 * показывает введённое, а не старое значение из строки.
 */
function AmountField({
  rowId,
  label,
  value,
  onSave,
}: {
  rowId: string;
  label: string;
  value: unknown;
  onSave: (raw: string) => Promise<void>;
}) {
  const shown = String(value ?? "").trim();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  // Другая строка (стрелки в карточке) — правка не переезжает на неё.
  useEffect(() => {
    setEditing(false);
  }, [rowId]);

  async function commit() {
    setEditing(false);
    if (draft.trim() === shown) return;
    setSaving(true);
    try {
      await onSave(draft);
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        inputMode="decimal"
        aria-label={label}
        onChange={(e) => setDraft(e.target.value)}
        // Сумма выделена целиком: новая сумма просто печатается поверх старой.
        onFocus={(e) => e.currentTarget.select()}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Enter") {
            e.preventDefault();
            void commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setEditing(false);
          }
        }}
        className="h-9 w-32 rounded-md border border-primary bg-background px-2 text-right font-mono text-[13px] tabular-nums outline-none ring-1 ring-primary sm:h-8"
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => {
        setDraft(shown);
        setEditing(true);
      }}
      disabled={saving}
      title={`Изменить: ${label.toLowerCase()}`}
      className="inline-flex h-9 min-w-[5.5rem] items-center justify-end gap-1.5 rounded-md border border-dashed border-border px-2 font-mono text-[13px] tabular-nums transition-colors hover:border-primary/50 hover:bg-primary/[0.06] sm:h-8"
    >
      {saving ? <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" /> : null}
      {shown ? formatCurrency(cellAmount(value)) : <span className="font-sans text-muted-foreground">+ сумма</span>}
    </button>
  );
}

/** Подпись чипа в шапке панели там, где в ячейке только значок. */
const CHIP_FALLBACK: Partial<Record<OsTechCellState["kind"], string>> = {
  "with-tech": "у технаря",
  loading: "ждём…",
};

/** Что сказать под технарём — по состоянию выдачи (то же, что в ячейке). */
function stateHint(state: OsTechCellState, claims: number): string | null {
  switch (state.kind) {
    case "issue":
      return "Заказ ещё не выдан. «Выдать…» — всем на «Заказы» или одному технарю.";
    case "reissue":
      return "Прежний заказ сняли с «Заказов». «Выдать заново…» — всем или одному технарю.";
    case "give":
      return "Технарь намечен. Нажмите «Отдать» — заказ уедет к нему.";
    case "pick":
      return "Технаря нет. Выберите — заказ уедет к нему сразу.";
    case "waiting":
      return "На «Заказах», ждём откликов. Можно отдать и напрямую, не дожидаясь.";
    case "claims":
      return `На «Заказах»: откликнулись ${claims}. Выберите технаря — заказ приедет к нему сам.`;
    case "handoff":
      return "Отдан с «Заказов» — заказ едет в стол технаря, ник появится сам.";
    case "travelling":
      return "Заказ уедет к технарю сам через секунду.";
    case "loading":
      return state.title;
    default:
      return null;
  }
}

/**
 * «Выдача» в карточке строки стола ОС: кто технарь, что у него сейчас и ОДНА
 * главная кнопка — та же, что чип в ячейке «Технарь» (состояние считает
 * `osTechCellState`, его передаёт стол; действие — `onAction`, тот же
 * обработчик, что у таблицы). Раньше карточка спорила с таблицей: у заказа
 * на «Утверждении» с технарём предлагала «Отдать заказ…», обещала «стол
 * спросит» и называлась «Заказ у технаря», даже если заказ никому не выдан.
 *
 * Статус ОС меняет в шапке карточки (там столбец «Статус»); здесь — статус
 * У ТЕХНАРЯ, прочитанный из его копии, и «Отправить ваш», если они разошлись.
 */
export function OsOrderPanel({
  row,
  pageId,
  subPageId,
  osUid,
  osNickValue,
  mirror,
  onChanged,
  state,
  onAction,
  busy = false,
  problem = null,
  claims = 0,
  keys = OS_DESK_KEYS,
  payment,
  dates,
  upsellDate,
  onSetDate,
}: {
  row: PageRow;
  pageId: string;
  subPageId: string | null;
  osUid: string;
  osNickValue: string;
  /** Строка этого заказа в столе технаря, если он уже выдан. */
  mirror: PageRow | null;
  onChanged: () => void;
  /** Состояние выдачи — то же, что рисует ячейка «Технарь». */
  state: OsTechCellState | null;
  /** Нажатие главной кнопки / «Сменить» — тот же обработчик, что у ячейки. */
  onAction: (action: OsTechAction) => void;
  /** По строке идёт запись (главная кнопка крутится). */
  busy?: boolean;
  /** Почему заказ не доходит до технаря (проход стола). */
  problem?: string | null;
  /** Сколько откликов на «Заказах». */
  claims?: number;
  /** Ключи ячеек открытой таблицы стола ОС. */
  keys?: OsDeskKeys;
  /** Когда заказ получен и выдан — то же, что в столбце «Даты». */
  dates?: OsDatesInfo;
  /** Дата апсейла (поставленная ОС и рекомендуемая). */
  upsellDate?: OsDateSlot;
  /** Поставить дату (нет — только показ). */
  onSetDate?: OsDateSetter;
  /** Касса: способы оплаты у цены и апсейла (на телефоне — только отсюда). */
  payment?: {
    methods: readonly PaymentMethod[];
    canConfigure: boolean;
    onPick: (colKey: string, method: PaymentMethod | null) => void;
    onConfigure: () => void;
    /** Правка суммы цены/апсейла прямо в «Кассе» (нет — сумма только показана). */
    onAmount?: (colKey: string, raw: string) => Promise<void>;
  };
}) {
  const { activeWorkspaceId, activeWorkspace, pages, members } = useWorkspace();
  const [pushing, setPushing] = useState(false);
  const statusOptions = ensureApprovalStatus(ensureDoneStatus(activeWorkspace?.statusOptions ?? DEFAULT_STATUS_OPTIONS));

  const kind = state?.kind ?? null;
  const techNick = cellText(row, keys.technician);
  const techUid = techUidByNick(members, techNick);
  // Отдать некому (нет аккаунта, стола, карты столбцов) — «Выдать заново» не
  // предлагаем, причина и так написана.
  const targetProblem = techNick ? techTargetProblem(pages, techUid, mirror?.deskPageId ?? row.mirrorPageId) : null;
  const theirStatus = state?.theirStatus ?? (mirror?.statusKey ? cellText(mirror, mirror.statusKey) : null);

  // Связь с копией оборвана: копию удалили (выдать заново можно) или Owner
  // вернул заказ технарю, и его строка у него в столе (новая копия была бы
  // дублем). Что из двух — спрашиваем базу один раз на открытие карточки;
  // пока не знаем, «Выдать заново» не предлагаем. Не прочиталось — кнопка
  // есть: выдача всё равно проверит ещё раз и откажет с причиной.
  const deadLink = kind === "problem" && problem === OS_DEAD_LINK_PROBLEM;
  const [returned, setReturned] = useState<boolean | null>(null);
  useEffect(() => {
    setReturned(null);
    if (!deadLink || !activeWorkspaceId || !techUid) return;
    let cancelled = false;
    returnedRowOnTechDesk({ workspaceId: activeWorkspaceId, row, techUid, pages })
      .then((value) => {
        if (!cancelled) setReturned(value);
      })
      .catch(() => {
        if (!cancelled) setReturned(false);
      });
    return () => {
      cancelled = true;
    };
    // Спрашиваем по строке и технарю, а не на каждый снимок столов.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deadLink, activeWorkspaceId, techUid, row.id]);

  async function handlePush() {
    if (!activeWorkspaceId) return;
    setPushing(true);
    try {
      const { techName, updated } = await pushOsRowToTech({
        workspaceId: activeWorkspaceId,
        osUid,
        osNickValue,
        row,
        pageId,
        subPageId,
        keys,
        mirror,
        pages,
        members,
        statusOptions,
      });
      toast.success(updated ? "Заказ обновлён у технаря" : `Заказ у технаря: ${techName}`);
      onChanged();
    } catch (error) {
      toast.error(firestoreErrorText(error, error instanceof Error ? error.message : "Не удалось отдать заказ технарю"));
    } finally {
      setPushing(false);
    }
  }

  // ОДНА главная кнопка — то же действие, что чип в ячейке.
  const who = state?.left.type === "badge" ? state.left.identity?.label : null;
  const primary: { label: string; icon: React.ReactNode; run: () => void } | null = (() => {
    if (!state) return null;
    const send = <Send className="h-4 w-4" />;
    switch (state.kind) {
      case "issue":
        return { label: "Выдать…", icon: send, run: () => onAction("choice") };
      case "reissue":
        return { label: "Выдать заново…", icon: send, run: () => onAction("choice") };
      case "give":
        return { label: who ? `Отдать ${who}` : "Отдать", icon: send, run: () => onAction("give") };
      case "pick":
        return { label: "Выбрать технаря", icon: <UserPlus className="h-4 w-4" />, run: () => onAction("picker-give") };
      case "waiting":
        return { label: "Отдать напрямую…", icon: <Hand className="h-4 w-4" />, run: () => onAction("exchange-picker") };
      case "claims":
        return { label: `Выбрать технаря · ${claims}`, icon: <Hand className="h-4 w-4" />, run: () => onAction("exchange-picker") };
      case "mismatch":
        return { label: "Отправить ваш статус", icon: <RefreshCw className="h-4 w-4" />, run: () => onAction("push-status") };
      case "problem":
        // Некуда отдавать (причина и так написана) или заказ вернули технарю
        // (его строка у него — выдавать нечего; пока не знаем — тоже нет).
        if (targetProblem || (deadLink && returned !== false)) return null;
        return { label: "Выдать заново", icon: send, run: () => void handlePush() };
      default:
        return null;
    }
  })();
  // «Сменить» / «Выбрать технаря» рядом с технарём — когда это не главная
  // кнопка и заказ не висит на «Заказах» (там выбирают из откликов).
  const onExchange = kind === "waiting" || kind === "claims" || kind === "handoff" || kind === "loading";
  const pickAction: OsTechAction | null =
    onExchange || kind === "pick" ? null : kind === "give" || !techNick ? "picker-give" : "picker-change";
  const hint = state ? stateHint(state, claims) : null;
  const headerChip = state?.chip
    ? {
        kind: state.kind,
        label: state.chip.label || CHIP_FALLBACK[state.kind] || "",
        title: state.title,
        tone: state.chip.tone,
        icon: state.chip.icon ?? undefined,
        passive: true,
      }
    : null;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-muted/30 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">Выдача</span>
        {headerChip ? <CellActionButton view={headerChip} inline onRun={() => undefined} /> : null}
      </div>

      {dates ? (
        <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1 text-xs">
          <span className="text-muted-foreground">Получен</span>
          <span>
            <OsDateButton size="card" slot={dates.received} icon={<ArrowDownToLine className="h-3.5 w-3.5 opacity-70" />} empty="—" onSet={onSetDate} />
          </span>
          <span className="text-muted-foreground">Выдан</span>
          <span>
            <OsDateButton
              size="card"
              slot={dates.issued}
              icon={<Send className="h-3.5 w-3.5 opacity-70" />}
              empty={dates.exchange ? (dates.exchange.status === "assigned" ? "отдан с «Заказов», едет" : "на «Заказах», ждёт откликов") : "ещё не выдан"}
              emptyClassName={dates.exchange ? "font-sans text-primary" : "font-sans"}
              onSet={onSetDate}
            />
          </span>
          {onSetDate && (dates.received.value === null || dates.issued.value === null) && (dates.received.suggested || dates.issued.suggested) ? (
            <span className="col-span-2 text-[11px] text-muted-foreground">Пунктир — рекомендуемая дата: нажмите, чтобы поставить.</span>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <span className="mb-1 block text-xs text-muted-foreground">Технарь</span>
          {state ? (
            <OsTechLeftView left={state.left} size="card" title={state.title} />
          ) : techNick ? (
            // Строка ещё не заказ (нет клиента), а технарь уже выбран — его
            // и показываем: в «Карточках» и в полях карточки его больше нигде нет.
            <TechBadge identity={resolveTechIdentity(techNick, members, activeWorkspace?.techNickOptions)} size="card" />
          ) : (
            <span className="text-sm text-muted-foreground">не выбран</span>
          )}
        </div>
        {pickAction ? (
          <Button variant="outline" size="sm" className="min-h-11 sm:min-h-9" onClick={() => onAction(pickAction)}>
            {techNick ? "Сменить" : "Выбрать технаря"}
          </Button>
        ) : null}
      </div>

      {mirror ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="text-muted-foreground">У технаря сейчас:</span>
          {theirStatus ? (
            <StatusBadge value={theirStatus} options={statusOptions} variant="plain" />
          ) : (
            <span className="text-muted-foreground">без статуса</span>
          )}
          {kind === "mismatch" ? <span className="text-xs text-warning">не совпадает с вашим</span> : null}
          {mirror.syncHash && row.syncHash && mirror.syncHash !== row.syncHash ? (
            <span className="text-xs text-muted-foreground">правка полей ещё едет</span>
          ) : null}
          {mirror.successRequestedAt ? (
            <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning">технарь просит «Успешку»</span>
          ) : null}
        </div>
      ) : null}

      {mirror && mirror.osUid === osUid ? (
        <OsOrderRating
          mirror={mirror}
          osUid={osUid}
          osNickValue={osNickValue}
          title={cellText(row, keys.client)}
          done={Boolean(theirStatus && isDoneStatusLabel(statusOptions.find((o) => o.value === theirStatus)?.label ?? theirStatus))}
        />
      ) : null}

      {payment ? (
        <div className="flex flex-col gap-1.5 rounded-lg border border-border/70 p-2">
          {[
            { key: keys.price, label: "Цена" },
            { key: keys.upsell, label: "Апсейл" },
          ].map((f) => (
            <div key={f.key} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="w-16 text-muted-foreground">{f.label}</span>
              {payment.onAmount ? (
                <AmountField rowId={row.id} label={f.label} value={row.cells[f.key]} onSave={(raw) => payment.onAmount!(f.key, raw)} />
              ) : (
                <span className="tabular-nums">{String(row.cells[f.key] ?? "").trim() ? formatCurrency(cellAmount(row.cells[f.key])) : "—"}</span>
              )}
              <PaymentChip
                row={row}
                colKey={f.key}
                methods={payment.methods}
                canEdit
                canConfigure={payment.canConfigure}
                onPick={(m) => payment.onPick(f.key, m)}
                onConfigure={payment.onConfigure}
              />
              {f.key === keys.upsell && upsellDate && String(row.cells[keys.upsell] ?? "").trim() ? (
                <OsDateButton size="card" slot={upsellDate} icon={null} empty="дата" emptyClassName="font-sans" onSet={onSetDate} />
              ) : null}
            </div>
          ))}
          {(() => {
            const total = osRowTotal(row, keys);
            const fees = osRowFees(row, keys);
            return (
              <p className="flex flex-wrap items-baseline gap-x-2 border-t border-border/60 pt-1.5 text-sm">
                <span className="w-16 text-muted-foreground">Итого</span>
                <span className="font-semibold tabular-nums">{total !== null ? formatCurrency(total) : "—"}</span>
                {fees > 0 ? <span className="text-xs text-muted-foreground">комиссия −{formatCurrency(fees)}</span> : null}
                <span className="basis-full text-[11px] text-muted-foreground">Эта сумма уходит технарю как цена заказа.</span>
              </p>
            );
          })()}
        </div>
      ) : null}

      {kind === "problem" && problem ? <p className="text-xs text-warning">Не доехал: {problem}</p> : null}
      {deadLink && returned ? <p className="text-xs text-muted-foreground">{OS_RETURNED_REISSUE_ERROR}</p> : null}
      {!problem && targetProblem && techNick && !mirror ? <p className="text-xs text-warning">{targetProblem}</p> : null}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}

      {primary || mirror ? (
        <div className="flex flex-wrap gap-2">
          {primary ? (
            <Button size="sm" className="min-h-11 sm:min-h-9" onClick={primary.run} disabled={busy || pushing}>
              {busy || pushing ? <Loader2 className="h-4 w-4 animate-spin" /> : primary.icon}
              {primary.label}
            </Button>
          ) : null}
          {mirror ? (
            <Button
              variant="ghost"
              size="sm"
              className="min-h-11 sm:min-h-9"
              title="Переслать поля и статус ещё раз"
              onClick={() => void handlePush()}
              disabled={pushing || Boolean(targetProblem)}
            >
              {pushing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Обновить у технаря
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
