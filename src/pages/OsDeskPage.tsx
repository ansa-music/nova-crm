import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { ClipboardList, Loader2 } from "lucide-react";
import { EmptyState } from "@/components/common/EmptyState";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspace } from "@/hooks/useWorkspace";
import { ensureOsDesk, findOsDeskOf } from "@/services/osDeskService";
import { myDisplayName } from "@/utils/displayName";

/**
 * «Стол ОС» — вход в личную таблицу ОС.
 *
 * Сама таблица рисуется обычным `/page/:id` (весь движок стола уже там),
 * поэтому здесь только «найти свой стол, при первом заходе завести и увести
 * на него». Owner своего стола ОС не имеет — ему показываем список чужих:
 * он и так видит все столы, а иначе проверить раздел ему было бы нечем.
 */
export default function OsDeskPage() {
  const { activeWorkspaceId, osDesks, members } = useWorkspace();
  const { profile } = useAuth();
  const permissions = usePermissions();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  // Заводим стол ровно один раз за заход: без этого повторный рендер
  // (снимок участников, смена роли) слал бы второй create подряд.
  const startedRef = useRef(false);

  const uid = profile?.uid ?? null;
  const isOs = permissions.isResolved && permissions.hasRole("os");
  const mine = findOsDeskOf(osDesks, uid);

  useEffect(() => {
    if (!activeWorkspaceId || !uid || !isOs) return;
    if (mine) {
      navigate(`/page/${mine.id}`, { replace: true });
      return;
    }
    if (startedRef.current) return;
    startedRef.current = true;
    let alive = true;
    void ensureOsDesk({ workspaceId: activeWorkspaceId, uid, name: myDisplayName(profile, members) })
      .then((page) => {
        if (alive) navigate(`/page/${page.id}`, { replace: true });
      })
      .catch((e) => {
        if (!alive) return;
        startedRef.current = false;
        setError(e instanceof Error ? e.message : "Не удалось открыть стол ОС");
      });
    return () => {
      alive = false;
    };
    // members меняется на каждом снимке присутствия — имя берём в момент
    // создания и в зависимости его не тащим.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId, uid, isOs, mine?.id, retry]);

  if (!permissions.isResolved) return null;

  if (isOs) {
    return (
      <div className="mx-auto w-full max-w-2xl p-5 sm:p-8">
        {error ? (
          <EmptyState
            eyebrow="Стол ОС"
            title="Не удалось открыть стол"
            description={error}
            action={
              <Button
                onClick={() => {
                  setError(null);
                  setRetry((v) => v + 1);
                }}
              >
                Повторить
              </Button>
            }
          />
        ) : (
          <p className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Открываем стол ОС…
          </p>
        )}
      </div>
    );
  }

  if (permissions.isWorkspaceOwner) {
    return (
      <div className="mx-auto w-full max-w-3xl p-5 sm:p-8">
        <PageHeader
          eyebrow="Студия"
          title="Столы ОС"
          description="Личные таблицы ОС: имя, номер, цена, апсейл, технарь. Кроме самого ОС их видите только вы."
        />
        {osDesks.length === 0 ? (
          <EmptyState eyebrow="Столы ОС" title="Столов ОС пока нет" description="Стол заводится сам, когда ОС первый раз открывает свой раздел." />
        ) : (
          <div className="flex flex-col gap-2">
            {osDesks.map((page) => {
              const owner = members.find((m) => m.uid === page.responsibleUserId);
              return (
                <Link
                  key={page.id}
                  to={`/page/${page.id}`}
                  className="flex items-center gap-3 rounded-xl border border-border bg-card/60 p-3 transition-colors hover:border-primary/40 hover:bg-accent/40"
                >
                  <ClipboardList className="h-4 w-4 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{page.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{owner?.name ?? owner?.email ?? "владелец не в участниках"}</p>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl p-5 sm:p-8">
      <EmptyState eyebrow="Стол ОС" title="Раздел только для ОС" description="Свой стол здесь заводит и ведёт ОС — остальным он не показывается." />
    </div>
  );
}
