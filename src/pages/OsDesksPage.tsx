import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { ArrowRight, Loader2, Lock, RefreshCw } from "lucide-react";
import { EmptyState } from "@/components/common/EmptyState";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { PageHeader } from "@/components/common/PageHeader";
import { RequestDeskViewButton } from "@/components/pagesnav/RequestDeskViewButton";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { useViewRequests } from "@/hooks/useViewRequests";
import { useWorkspace } from "@/hooks/useWorkspace";
import { osNickLabel } from "@/services/memberService";
import { fetchOsDeskMonthStats, type OsDeskMonthStats } from "@/services/osDeskStatsService";
import { cn } from "@/utils/cn";
import { timeAgo } from "@/utils/date";
import { deskHref, deskNavState } from "@/utils/deskLinks";
import { displayNameOf, myDisplayName } from "@/utils/displayName";
import { formatCurrency } from "@/utils/format";
import type { WorkspaceMember, WorkspacePage } from "@/types";

type StatsState = { status: "loading" } | { status: "ok"; stats: OsDeskMonthStats } | { status: "error" };

const MONTH_NAME = new Intl.DateTimeFormat("ru-RU", { month: "long", timeZone: "Asia/Almaty" });

/**
 * «Столы ОС» — личные таблицы ОС (`page.osDesk`) в одном месте. Видны ВСЕМ
 * участникам на чтение, без запроса (правило `isOsDeskPage` в
 * firestore.rules). Ветка «Запросить просмотр» осталась на случай, если
 * права ещё не разрешились. Сводка за месяц — по столам, которые смотрящий
 * вправе читать.
 */
export default function OsDesksPage() {
  const { activeWorkspaceId, activeWorkspace, osDesks, members } = useWorkspace();
  const { profile } = useAuth();
  const permissions = usePermissions();
  const uid = profile?.uid ?? null;
  const { requestView, latestForPage, reload } = useViewRequests(activeWorkspaceId, uid);
  const [stats, setStats] = useState<Record<string, StatsState>>({});
  const [refreshing, setRefreshing] = useState(false);

  const rows = useMemo(() => {
    const list = osDesks.map((page) => {
      const owner = members.find((m) => m.uid === page.responsibleUserId) ?? null;
      return { page, owner, canOpen: permissions.canAccessPage(page) };
    });
    // Свой стол — первым, дальше по имени ОС.
    return list.sort((a, b) => {
      if (a.page.responsibleUserId === uid) return -1;
      if (b.page.responsibleUserId === uid) return 1;
      return nameOf(a.owner, a.page).localeCompare(nameOf(b.owner, b.page), "ru");
    });
  }, [osDesks, members, permissions, uid]);

  const openable = useMemo(() => rows.filter((r) => r.canOpen).map((r) => r.page), [rows]);
  const openableKey = openable.map((p) => p.id).join(",");

  const load = useCallback(
    async (force: boolean) => {
      if (!activeWorkspaceId || openable.length === 0) return;
      setStats((prev) => {
        const next = { ...prev };
        for (const page of openable) if (force || !next[page.id]) next[page.id] = { status: "loading" };
        return next;
      });
      await Promise.all(
        openable.map(async (page) => {
          try {
            const s = await fetchOsDeskMonthStats(activeWorkspaceId, page, { force });
            setStats((prev) => ({ ...prev, [page.id]: { status: "ok", stats: s } }));
          } catch (error) {
            console.error("fetchOsDeskMonthStats failed:", error);
            setStats((prev) => ({ ...prev, [page.id]: { status: "error" } }));
          }
        })
      );
    },
    // openableKey — стабильный ключ набора столов вместо массива объектов.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeWorkspaceId, openableKey]
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  if (!permissions.isResolved) return null;

  const totals = openable.reduce(
    (acc, page) => {
      const s = stats[page.id];
      if (s?.status !== "ok") return acc;
      acc.today += s.stats.todayCount;
      acc.month += s.stats.monthCount;
      acc.price += s.stats.priceSum;
      acc.upsell += s.stats.upsellSum;
      acc.net += s.stats.netSum ?? 0;
      return acc;
    },
    { today: 0, month: 0, price: 0, upsell: 0, net: 0 }
  );
  const monthName = MONTH_NAME.format(new Date());

  async function refresh() {
    setRefreshing(true);
    try {
      await load(true);
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-5xl p-4 sm:p-8">
      <PageHeader
        eyebrow="Мониторинг"
        title="Столы ОС"
        description={
          permissions.hasFullDeskAccess
            ? `Личные таблицы ОС: что записано сегодня и за ${monthName}, цена и апсейл. Вы видите и правите все столы ОС.`
            : permissions.seesOsDesks
              ? `Личные таблицы ОС: что записано сегодня и за ${monthName}, цена и апсейл. Чужие столы открыты всем на просмотр.`
              : "Личные таблицы ОС. Чтобы открыть чужой стол, запросите просмотр — разрешает сам ОС."
        }
        actions={
          openable.length > 0 ? (
            <Button variant="outline" className="min-h-11 gap-1.5 sm:min-h-0" onClick={() => void refresh()} disabled={refreshing}>
              {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Обновить
            </Button>
          ) : undefined
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          eyebrow="Столы ОС"
          title="Столов ОС пока нет"
          description="Стол заводится сам, когда ОС первый раз открывает свой раздел «Стол ОС»."
        />
      ) : (
        <>
          {openable.length > 1 && (
            <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
              <Tile label="Сегодня" value={String(totals.today)} hint="заказов у всех" />
              <Tile label={`За ${monthName}`} value={String(totals.month)} hint="заказов у всех" />
              <Tile label="Цена" value={formatCurrency(totals.price)} hint="за месяц" />
              <Tile label="Апсейл" value={formatCurrency(totals.upsell)} hint="за месяц" />
              <Tile label="Касса" value={formatCurrency(totals.net)} hint="за вычетом комиссий" />
            </div>
          )}
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,280px),1fr))]">
            {rows.map(({ page, owner, canOpen }) => {
              const mine = page.responsibleUserId === uid;
              const nick = owner ? osNickLabel(owner, activeWorkspace?.responsibleOptions) : null;
              const s = stats[page.id];
              return (
                <article
                  key={page.id}
                  className={cn(
                    "flex min-w-0 flex-col gap-3 rounded-2xl border bg-card/70 p-4",
                    mine ? "border-primary/40" : "border-border/70"
                  )}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <MemberAvatar
                      id={page.responsibleUserId ?? page.id}
                      name={owner?.name}
                      nickname={owner?.nickname}
                      photoURL={owner?.photoURL}
                      className="h-9 w-9 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">
                        {nameOf(owner, page)}
                        {mine && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(ваш)</span>}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {owner ? (nick ? "стол ОС" : "ник ОС не закреплён") : "не в команде"}
                      </p>
                    </div>
                    {!canOpen && <Lock className="h-4 w-4 shrink-0 text-muted-foreground" />}
                  </div>

                  {canOpen ? (
                    s?.status === "ok" ? (
                      <>
                        <div className="grid grid-cols-2 gap-2">
                          <Stat label="Сегодня" value={String(s.stats.todayCount)} />
                          <Stat label={`За ${monthName}`} value={String(s.stats.monthCount)} />
                          <Stat label="Цена" value={formatCurrency(s.stats.priceSum)} />
                          <Stat label="Апсейл" value={formatCurrency(s.stats.upsellSum)} />
                          <div className="col-span-2">
                            <Stat label="Касса (за вычетом комиссий)" value={formatCurrency(s.stats.netSum ?? 0)} />
                          </div>
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          {s.stats.lastActivityAt ? `Последняя запись ${timeAgo(s.stats.lastActivityAt)}` : "В этом месяце записей нет"}
                        </p>
                      </>
                    ) : s?.status === "error" ? (
                      <p className="text-[12px] text-warning">Сводку не удалось прочитать — нажмите «Обновить».</p>
                    ) : (
                      <p className="flex items-center gap-2 text-[12px] text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Считаем месяц…
                      </p>
                    )
                  ) : (
                    <p className="text-[12px] text-muted-foreground">
                      Стол закрыт. Сводку и таблицу видно после разрешения ОС.
                    </p>
                  )}

                  <div className="mt-auto">
                    {canOpen ? (
                      <Button asChild variant={mine ? "default" : "outline"} className="min-h-11 w-full gap-1.5 sm:min-h-9">
                        <Link to={deskHref(page.id)} state={deskNavState({ to: "/os-desks", label: "Столы ОС" })}>
                          {mine ? "Открыть свой стол" : permissions.canEditPageData(page) ? "Открыть" : "Смотреть"}
                          <ArrowRight className="h-4 w-4" />
                        </Link>
                      </Button>
                    ) : owner && owner.status === "active" && uid && page.responsibleUserId !== uid ? (
                      // Ошибку не глотаем: кнопка сама покажет её и не скажет
                      // «Запрос отправлен» про несохранённый запрос.
                      <RequestDeskViewButton
                        page={page}
                        mine={latestForPage(page.id)}
                        onRequest={async () => {
                          await requestView(page, myDisplayName(profile, members), page.responsibleUserId!);
                          reload();
                        }}
                      />
                    ) : !owner || owner.status !== "active" ? (
                      <p className="text-[11px] text-muted-foreground">ОС больше нет в команде — доступ к столу выдаёт Owner.</p>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function nameOf(owner: WorkspaceMember | null, page: WorkspacePage): string {
  return owner ? displayNameOf(owner) : page.name;
}

function Tile({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-border/70 bg-card/60 p-3">
      <p className="truncate text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate text-lg font-semibold tabular-nums">{value}</p>
      <p className="truncate text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-muted/40 px-2.5 py-1.5">
      <p className="truncate text-[10px] uppercase tracking-[0.1em] text-muted-foreground">{label}</p>
      <p className="truncate text-sm font-semibold tabular-nums">{value}</p>
    </div>
  );
}

