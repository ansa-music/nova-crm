import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router";
import { Loader2 } from "lucide-react";
import { EmptyState } from "@/components/common/EmptyState";
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
 * на него». Кто сам не ОС — уходит на «Столы ОС» (`OsDesksPage`): общий
 * мониторинг всех столов ОС.
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

  // Своего стола ОС нет — ведём на общий мониторинг «Столы ОС»: там все столы
  // ОС, руководство смотрит их напрямую, остальные — по запросу.
  return <Navigate to="/os-desks" replace />;
}
