import { useEffect, useRef, useState } from "react";
import { MoveRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { listCarryCandidates, type CarryCandidates } from "@/services/rows/carryOver";
import { carryDismissKey } from "@/utils/carryOver";
import { formatCount, pluralRu } from "@/utils/format";
import type { StatusOption, SubPage, TechLoadKind, WorkspacePage } from "@/types";

function readDismissed(pageId: string, tabId: string): boolean {
  try {
    return window.sessionStorage.getItem(carryDismissKey(pageId, tabId)) !== null;
  } catch {
    return false;
  }
}

/**
 * Плашка над столом технаря на вкладке нового периода: «в прошлом периоде
 * осталось N заказов в работе — перенести сюда». Кандидаты читаются один раз
 * на стол и вкладку (память модуля в services/rows/carryOver), «Не сейчас»
 * помнится на вкладку браузера.
 */
export function CarryOverBanner({
  workspaceId,
  page,
  fromTab,
  toTab,
  fromLabel,
  statusOptions,
  kinds,
  refreshKey,
  onOpen,
}: {
  workspaceId: string;
  page: WorkspacePage;
  fromTab: SubPage;
  toTab: SubPage;
  fromLabel: string;
  statusOptions: readonly StatusOption[];
  kinds: Record<string, TechLoadKind> | undefined;
  /** Растёт после переноса — кандидаты перечитываются мимо памяти. */
  refreshKey: number;
  onOpen: (candidates: CarryCandidates) => void;
}) {
  const [candidates, setCandidates] = useState<CarryCandidates | null>(null);
  const [dismissed, setDismissed] = useState(() => readDismissed(page.id, toTab.id));
  const seenRefresh = useRef(refreshKey);

  useEffect(() => {
    setDismissed(readDismissed(page.id, toTab.id));
  }, [page.id, toTab.id]);

  // Стол и вкладка — по id: объекты страницы пересобираются на каждом снимке.
  const pageId = page.id;
  const fromTabId = fromTab.id;
  const pageRef = useRef(page);
  pageRef.current = page;
  const fromTabRef = useRef(fromTab);
  fromTabRef.current = fromTab;
  useEffect(() => {
    let alive = true;
    const force = seenRefresh.current !== refreshKey;
    seenRefresh.current = refreshKey;
    listCarryCandidates({ workspaceId, page: pageRef.current, fromTab: fromTabRef.current, statusOptions, kinds, force })
      .then((next) => {
        if (alive) setCandidates(next);
      })
      .catch(() => {
        if (alive) setCandidates(null);
      });
    return () => {
      alive = false;
    };
  }, [workspaceId, pageId, fromTabId, statusOptions, kinds, refreshKey]);

  if (dismissed || !candidates) return null;
  const unfinished = candidates.groups.unfinished.length;
  const payment = candidates.groups.payment.length;
  if (unfinished + payment === 0) return null;

  const dismiss = () => {
    try {
      window.sessionStorage.setItem(carryDismissKey(page.id, toTab.id), String(Date.now()));
    } catch {
      /* приватный режим */
    }
    setDismissed(true);
  };

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-sky-400/30 bg-sky-400/[0.07] px-4 py-2 text-sm">
      <MoveRight className="h-4 w-4 shrink-0 text-sky-300" />
      {/* На телефоне кнопки уходят на свою строку — иначе текст сжимался в узкий столбик. */}
      <span className="min-w-0 flex-1 basis-full sm:basis-0">
        <span className="font-medium">
          {unfinished > 0 ? (
            <>
              В периоде «{fromLabel}» осталось {formatCount(unfinished, ["заказ", "заказа", "заказов"])} в работе
              {payment > 0 ? ` (и ${payment} ${pluralRu(payment, ["ждёт", "ждут", "ждут"])} оплату)` : ""}.
            </>
          ) : (
            <>
              В периоде «{fromLabel}» {payment} {pluralRu(payment, ["заказ ждёт", "заказа ждут", "заказов ждут"])} оплату.
            </>
          )}
        </span>{" "}
        <span className="text-muted-foreground">
          Перенесите их сюда — прошлый период их считать перестанет, а этот начнёт.
        </span>
      </span>
      <span className="flex gap-2 pl-7 sm:pl-0">
        <Button size="sm" className="min-h-9" onClick={() => onOpen(candidates)}>
          {unfinished > 0 ? "Перенести сюда" : "Посмотреть"}
        </Button>
        <Button size="sm" variant="ghost" className="min-h-9" onClick={dismiss}>
          Не сейчас
        </Button>
      </span>
    </div>
  );
}
