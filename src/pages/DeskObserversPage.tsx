import { useEffect, useMemo, useState } from "react";
import { Eye, EyeOff, Loader2, Search } from "lucide-react";
import { EmptyState } from "@/components/common/EmptyState";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspace } from "@/hooks/useWorkspace";
import {
  fetchDeskObservers,
  grantDeskObserver,
  revokeDeskObserver,
  type DeskObserver,
} from "@/services/deskObserverService";
import { displayNameOf } from "@/utils/displayName";
import { cn } from "@/utils/cn";

/**
 * Скрытая страница Owner: кому открыты ЧУЖИЕ столы на чтение.
 *
 * В меню её нет и в поиске тоже — заходить по прямому адресу `/observers`.
 * Список наблюдателей читает только Owner (правило `deskObservers`), сами
 * наблюдатели видят лишь свой документ, остальные — ничего.
 */
export default function DeskObserversPage() {
  const { activeWorkspaceId, members } = useWorkspace();
  const { profile } = useAuth();
  const permissions = usePermissions();
  const [rows, setRows] = useState<DeskObserver[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const isOwner = permissions.isResolved && permissions.isWorkspaceOwner;

  useEffect(() => {
    if (!activeWorkspaceId || !isOwner) return;
    let alive = true;
    void fetchDeskObservers(activeWorkspaceId)
      .then((list) => alive && setRows(list))
      .catch(() => alive && setRows([]));
    return () => {
      alive = false;
    };
  }, [activeWorkspaceId, isOwner]);

  const granted = useMemo(() => new Set((rows ?? []).map((r) => r.uid)), [rows]);
  const people = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return members
      .filter((m) => m.status === "active" && m.uid && m.uid !== profile?.uid)
      .filter((m) => !needle || displayNameOf(m).toLowerCase().includes(needle) || (m.email ?? "").toLowerCase().includes(needle))
      .sort((a, b) => Number(granted.has(b.uid)) - Number(granted.has(a.uid)) || displayNameOf(a).localeCompare(displayNameOf(b), "ru"));
  }, [members, q, granted, profile?.uid]);

  if (!permissions.isResolved) return null;
  if (!isOwner) {
    return (
      <div className="mx-auto w-full max-w-xl p-5 sm:p-8">
        <EmptyState eyebrow="Доступ" title="Страница недоступна" description="Здесь ничего нет." />
      </div>
    );
  }

  async function toggle(uid: string, label: string, on: boolean) {
    if (!activeWorkspaceId || !profile) return;
    setBusy(uid);
    try {
      if (on) await grantDeskObserver({ workspaceId: activeWorkspaceId, uid, label, ownerUid: profile.uid });
      else await revokeDeskObserver(activeWorkspaceId, uid);
      setRows(await fetchDeskObservers(activeWorkspaceId));
      toast.success(on ? "Доступ открыт" : "Доступ снят");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось изменить доступ");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl p-5 sm:p-8">
      <PageHeader
        eyebrow="Доступ"
        title="Наблюдатели"
        description="Видят чужие столы на чтение — без правки и без личной зоны. В «Доступе к столу» не показываются, об этом знаете только вы и сам человек."
      />
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по людям" className="pl-9" />
      </div>
      {rows === null ? (
        <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Загружаем…
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {people.map((m) => {
            const on = granted.has(m.uid);
            const label = displayNameOf(m);
            return (
              <div
                key={m.uid}
                className={cn(
                  "flex items-center gap-3 rounded-xl border p-2.5",
                  on ? "border-primary/40 bg-primary/[0.06]" : "border-border bg-card/60"
                )}
              >
                <MemberAvatar id={m.uid} name={m.name} nickname={m.nickname} photoURL={m.photoURL} className="h-8 w-8 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{label}</p>
                  <p className="truncate text-xs text-muted-foreground">{on ? "видит все столы" : (m.email ?? "")}</p>
                </div>
                <Button
                  size="sm"
                  variant={on ? "outline" : "default"}
                  className="h-9 shrink-0 gap-1.5"
                  disabled={busy !== null}
                  onClick={() => void toggle(m.uid, label, !on)}
                >
                  {busy === m.uid ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : on ? (
                    <EyeOff className="h-3.5 w-3.5" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )}
                  {on ? "Снять" : "Открыть"}
                </Button>
              </div>
            );
          })}
          {people.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">Никого не нашлось.</p>}
        </div>
      )}
    </div>
  );
}
