import { useEffect, useRef, useState } from "react";
import { CalendarClock, Clock3, ExternalLink, IdCard, Link2, Loader2, NotebookPen, Users } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { parseOptionalNumber } from "@/utils/quickOrder";
import { normalizeRowExtras, type RowExtras } from "@/utils/rowExtras";
import { parseHttpUrl } from "@/utils/httpUrl";
import { almatyNoonMillis, formatOrderDate, ymdInTimeZone } from "@/utils/date";
import { cn } from "@/utils/cn";

const PERSON_PICKS = [1, 2, 3, 4, 5, 6];
const MINUTE_PICKS = [1, 2, 3, 5, 10];
/** Пауза после последнего нажатия, через которую текст и дата уезжают в базу. */
const TEXT_SAVE_DELAY_MS = 900;

/** «YYYY-MM-DD» → полдень этого дня по Алматы, как в «Выдать заказ». */
function deadlineToMillis(raw: string): number | null {
  if (!raw) return null;
  const [y, m, d] = raw.split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  // Год из одной-двух цифр — человек ещё печатает; такую дату не пишем.
  if (y < 2000) return null;
  const ms = almatyNoonMillis(y, m - 1, d);
  return Number.isFinite(ms) ? ms : null;
}

function numberText(value: number | null | undefined) {
  return value == null ? "" : String(value);
}

function sameExtras(a: RowExtras | null, b: RowExtras | null): boolean {
  return (
    (a?.persons ?? null) === (b?.persons ?? null) &&
    (a?.minutes ?? null) === (b?.minutes ?? null) &&
    (a?.note ?? "") === (b?.note ?? "") &&
    (a?.link ?? "") === (b?.link ?? "") &&
    (a?.deadline ?? null) === (b?.deadline ?? null)
  );
}

/**
 * «Визитка клиента» внутри карточки строки (просьба Nurba 25.09.2026:
 * «объедини карточку клиента с визиткой, сделай основой, чтобы удобно было
 * заполнять клиента, и технарь видел фулл инфу; один клик — открывает»).
 * Раньше это было отдельное окно с «Сохранить»; теперь — верхняя секция
 * карточки, и всё пишется само: чипы — сразу, дата, ссылка и пожелания —
 * через паузу после печати или по уходу с поля. Без права правки — те же
 * поля текстом.
 */
export function ClientCardSection({
  rowId,
  initial,
  canEdit,
  onSave,
}: {
  rowId: string;
  initial: RowExtras;
  canEdit: boolean;
  onSave: (next: RowExtras | null) => Promise<void>;
}) {
  const [persons, setPersons] = useState(() => numberText(initial.persons));
  const [minutes, setMinutes] = useState(() => numberText(initial.minutes));
  const [note, setNote] = useState(() => initial.note ?? "");
  const [link, setLink] = useState(() => initial.link ?? "");
  const [deadline, setDeadline] = useState(() => (initial.deadline != null ? ymdInTimeZone(initial.deadline) : ""));
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  // Что уже лежит в базе (по нашим данным): с этим сравнивается черновик,
  // чтобы не писать одно и то же и не откатывать ввод живым снимком строки.
  const savedRef = useRef<RowExtras | null>(normalizeRowExtras(initial));
  const timerRef = useRef<number | null>(null);
  const focusedRef = useRef(false);
  const draftRef = useRef<RowExtras | null>(null);

  // Другая строка — новый черновик. Живые правки той же строки (кто-то
  // сохранил с другого устройства) черновик не трогают, пока человек печатает.
  useEffect(() => {
    setPersons(numberText(initial.persons));
    setMinutes(numberText(initial.minutes));
    setNote(initial.note ?? "");
    setLink(initial.link ?? "");
    setDeadline(initial.deadline != null ? ymdInTimeZone(initial.deadline) : "");
    savedRef.current = normalizeRowExtras(initial);
    setState("idle");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowId]);
  useEffect(() => {
    if (focusedRef.current) return;
    const live = normalizeRowExtras(initial);
    if (sameExtras(live, savedRef.current)) return;
    savedRef.current = live;
    setPersons(numberText(live?.persons));
    setMinutes(numberText(live?.minutes));
    setNote(live?.note ?? "");
    setLink(live?.link ?? "");
    setDeadline(live?.deadline != null ? ymdInTimeZone(live.deadline) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial.persons, initial.minutes, initial.note, initial.link, initial.deadline]);

  const personsNum = parseOptionalNumber(persons);
  const minutesNum = parseOptionalNumber(minutes);
  const personsBad = persons.trim() !== "" && personsNum == null;
  const minutesBad = minutes.trim() !== "" && minutesNum == null;
  const deadlineMs = deadlineToMillis(deadline);
  const draft = normalizeRowExtras({ persons: personsNum, minutes: minutesNum, note, link, deadline: deadlineMs });
  draftRef.current = draft;

  async function flush() {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const next = draftRef.current;
    if (!canEdit || personsBad || minutesBad) return;
    if (sameExtras(next, savedRef.current)) return;
    savedRef.current = next;
    setState("saving");
    try {
      await onSave(next);
      setState("saved");
    } catch {
      setState("idle");
    }
  }
  function scheduleSave() {
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => void flush(), TEXT_SAVE_DELAY_MS);
  }
  // Чипы пишутся сразу: значение уже полное, ждать нечего.
  useEffect(() => {
    if (!canEdit) return;
    if (sameExtras(draft, savedRef.current)) return;
    if (timerRef.current != null) return; // текст ещё печатается — уедет вместе
    if (focusedRef.current) return; // печать в поле — по паузе/уходу с поля
    void flush();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personsNum, minutesNum]);
  useEffect(
    () => () => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
    },
    []
  );

  const href = parseHttpUrl(link);

  function pickChip(active: boolean) {
    return cn(
      "h-8 min-w-8 rounded-md border px-2.5 text-xs font-medium tabular-nums transition-colors disabled:opacity-60",
      active ? "border-primary/30 bg-primary/[0.12] text-primary" : "border-border bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground"
    );
  }
  const fieldProps = {
    onFocus: () => {
      focusedRef.current = true;
    },
    onBlur: () => {
      focusedRef.current = false;
      void flush();
    },
  };

  const statusText = state === "saving" ? "сохраняю…" : state === "saved" ? "сохранено" : canEdit ? "пишется само" : "только просмотр";

  if (!canEdit) {
    const items: Array<{ icon: React.ReactNode; label: string; value: React.ReactNode }> = [];
    if (initial.deadline != null) items.push({ icon: <CalendarClock className="h-3.5 w-3.5" />, label: "Дедлайн", value: `до ${formatOrderDate(initial.deadline)}` });
    if (initial.persons != null) items.push({ icon: <Users className="h-3.5 w-3.5" />, label: "Персонажи", value: initial.persons });
    if (initial.minutes != null) items.push({ icon: <Clock3 className="h-3.5 w-3.5" />, label: "Минуты", value: initial.minutes });
    if (initial.link?.trim()) {
      const url = parseHttpUrl(initial.link);
      items.push({
        icon: <Link2 className="h-3.5 w-3.5" />,
        label: "Ссылка",
        value: url ? (
          <a href={url.toString()} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-primary hover:underline">
            {initial.link} <ExternalLink className="h-3 w-3" />
          </a>
        ) : (
          initial.link
        ),
      });
    }
    return (
      <section className="rounded-xl border border-primary/30 bg-primary/[0.05] p-3 sm:p-4">
        <p className="eyebrow mb-2 flex items-center gap-1.5 text-primary">
          <IdCard className="h-3.5 w-3.5" /> Визитка клиента
          <span className="ml-auto font-sans text-[11px] normal-case tracking-normal text-muted-foreground">{statusText}</span>
        </p>
        {items.length === 0 && !initial.note?.trim() ? (
          <p className="text-sm text-muted-foreground">Пусто — персы, минуты, дедлайн и пожелания заполняет тот, кто ведёт заказ.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {items.length > 0 && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {items.map((it) => (
                  <span key={it.label} className="inline-flex items-center gap-1.5">
                    <span className="text-muted-foreground">{it.icon}</span>
                    <span className="text-[12px] text-muted-foreground">{it.label}</span>
                    <span className="font-medium tabular-nums">{it.value}</span>
                  </span>
                ))}
              </div>
            )}
            {initial.note?.trim() && <p className="whitespace-pre-wrap break-words text-sm">{initial.note}</p>}
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-primary/30 bg-primary/[0.05] p-3 sm:p-4">
      <p className="eyebrow mb-3 flex items-center gap-1.5 text-primary">
        <IdCard className="h-3.5 w-3.5" /> Визитка клиента
        <span className="ml-auto inline-flex items-center gap-1 font-sans text-[11px] normal-case tracking-normal text-muted-foreground">
          {state === "saving" && <Loader2 className="h-3 w-3 animate-spin" />}
          {statusText}
        </span>
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <Users className="h-3.5 w-3.5" /> Персонажи
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            {PERSON_PICKS.map((n) => (
              <button key={n} type="button" className={pickChip(personsNum === n)} onClick={() => setPersons(personsNum === n ? "" : String(n))}>
                {n}
              </button>
            ))}
            <Input
              value={persons}
              onChange={(e) => {
                setPersons(e.target.value);
                scheduleSave();
              }}
              {...fieldProps}
              inputMode="numeric"
              autoComplete="off"
              placeholder="другое"
              aria-label="Персонажи"
              className={cn("h-8 w-20 text-sm", personsBad && "border-destructive")}
            />
          </div>
        </div>
        <div className="grid gap-1.5">
          <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <Clock3 className="h-3.5 w-3.5" /> Минуты
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            {MINUTE_PICKS.map((n) => (
              <button key={n} type="button" className={pickChip(minutesNum === n)} onClick={() => setMinutes(minutesNum === n ? "" : String(n))}>
                {n}
              </button>
            ))}
            <Input
              value={minutes}
              onChange={(e) => {
                setMinutes(e.target.value);
                scheduleSave();
              }}
              {...fieldProps}
              inputMode="decimal"
              autoComplete="off"
              placeholder="другое"
              aria-label="Минуты"
              className={cn("h-8 w-20 text-sm", minutesBad && "border-destructive")}
            />
          </div>
        </div>
        <div className="grid gap-1.5">
          <label htmlFor={`cc-deadline-${rowId}`} className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <CalendarClock className="h-3.5 w-3.5" /> Дедлайн сдачи
          </label>
          {/* Браузер шлёт change на каждую цифру («15» → сначала 01.09) —
              поэтому дата уезжает по паузе/уходу с поля, а не с первой цифры. */}
          <Input
            id={`cc-deadline-${rowId}`}
            type="date"
            value={deadline}
            onChange={(e) => {
              setDeadline(e.target.value);
              scheduleSave();
            }}
            {...fieldProps}
            className="h-9 w-full sm:w-44"
          />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor={`cc-link-${rowId}`} className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <Link2 className="h-3.5 w-3.5" /> Ссылка на клиента
          </label>
          <div className="flex items-center gap-2">
            <Input
              id={`cc-link-${rowId}`}
              value={link}
              onChange={(e) => {
                setLink(e.target.value);
                scheduleSave();
              }}
              {...fieldProps}
              placeholder="https://instagram.com/…"
              inputMode="url"
              autoComplete="off"
              className="h-9 min-w-0 flex-1"
            />
            {/* Только настоящий http(s)-адрес: «instagram.com/x» без схемы браузер увёл бы на страницу CRM. */}
            {href ? (
              <a
                href={href.toString()}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-primary/30 bg-primary/[0.12] px-2.5 text-xs font-medium text-primary hover:bg-primary/20"
                title="Открыть в новой вкладке"
              >
                <ExternalLink className="h-3.5 w-3.5" /> Открыть
              </a>
            ) : link.trim() ? (
              <span className="shrink-0 text-[11px] text-muted-foreground">нужен https://</span>
            ) : null}
          </div>
        </div>
        <div className="grid gap-1.5 sm:col-span-2">
          <label htmlFor={`cc-note-${rowId}`} className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <NotebookPen className="h-3.5 w-3.5" /> Пожелания
          </label>
          <Textarea
            id={`cc-note-${rowId}`}
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              scheduleSave();
            }}
            {...fieldProps}
            rows={3}
            placeholder="Стиль, музыка, сроки, кто есть кто — что угодно по желанию"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void flush();
              }
            }}
          />
        </div>
      </div>
    </section>
  );
}
