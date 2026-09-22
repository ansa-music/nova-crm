import { useMemo, useState } from "react";
import { Check, Loader2, Lock, Search, ShieldCheck, UserCog, X } from "lucide-react";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/utils/cn";
import { personLabel } from "@/utils/peopleDesks";
import {
  grokAppProviderLabel,
  rolesOf,
  type GrokAccessRequest,
  type GrokAccessStub,
  type WorkspaceMember,
} from "@/types";

/** Открыт ли человеку «Грок лимит» — зеркало canUseGrok: чистому ОС нет. */
export function canUseGrokMember(member: WorkspaceMember): boolean {
  return !rolesOf(member).every((role) => role === "os");
}

/**
 * Кто управляет разделом «Грок лимита» (Хикс, 11 Labs, Другие). Это право
 * страницы, а не роль: отметить можно любого участника — Технаря, Тимлида,
 * Admin. Owner и так может всё, в списке его нет.
 */
export function GrokManagersDialog({
  sectionTitle,
  members,
  managerUids,
  saving,
  onClose,
  onSave,
}: {
  sectionTitle: string;
  members: WorkspaceMember[];
  managerUids: string[];
  saving: boolean;
  onClose: () => void;
  onSave: (uids: string[]) => void;
}) {
  // Только те, кому «Грок лимит» вообще открыт: чистый ОС страницу не видит
  // (canUseGrok), и назначенный управляющим он ничего бы решить не смог.
  const eligible = useMemo(
    () =>
      members.filter(
        (m) => m.status === "active" && Boolean(m.uid) && m.role !== "owner" && canUseGrokMember(m)
      ),
    [members]
  );
  // Метки только у тех, кого видно в списке: иначе ушедший участник сидел бы в
  // «Сохранить · N» невидимым и записывался заново при каждом сохранении.
  const [selected, setSelected] = useState<string[]>(() => managerUids.filter((id) => eligible.some((m) => m.uid === id)));
  const [search, setSearch] = useState("");
  const people = useMemo(() => {
    const q = search.trim().toLowerCase();
    return eligible
      .filter((m) => !q || `${personLabel(m)} ${m.email ?? ""}`.toLowerCase().includes(q))
      .sort((a, b) => personLabel(a).localeCompare(personLabel(b), "ru"));
  }, [eligible, search]);

  function toggle(uid: string) {
    setSelected((prev) => (prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid]));
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserCog className="h-4 w-4 shrink-0 text-primary" />
            Кто управляет «{sectionTitle}»
          </DialogTitle>
          <DialogDescription>
            Отмеченные закрывают и открывают аккаунты «{sectionTitle}» и решают запросы на доступ. Это право только этой
            страницы и ролью не выдаётся — его нужно дать отдельно. В списке те, кому «Грок лимит» открыт (не чистые ОС);
            Owner может всё и так.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск по людям" className="h-9 pl-8" />
        </div>

        <div className="-mx-1 flex max-h-72 flex-col gap-0.5 overflow-y-auto px-1">
          {people.length === 0 && <p className="py-6 text-center text-[12px] text-muted-foreground">Никого не нашли.</p>}
          {people.map((member) => {
            const on = selected.includes(member.uid);
            return (
              <button
                key={member.uid}
                type="button"
                onClick={() => toggle(member.uid)}
                className={cn(
                  "flex min-h-11 min-w-0 items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition-colors sm:min-h-0",
                  on ? "border-primary/45 bg-primary/10" : "border-transparent hover:bg-accent/40"
                )}
              >
                <MemberAvatar
                  id={member.uid}
                  name={member.name}
                  nickname={member.nickname}
                  photoURL={member.photoURL}
                  className="h-7 w-7 shrink-0"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{personLabel(member)}</span>
                  {member.email && <span className="block truncate text-[11px] text-muted-foreground">{member.email}</span>}
                </span>
                <span
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded border",
                    on ? "border-primary bg-primary text-primary-foreground" : "border-border"
                  )}
                >
                  {on && <Check className="h-3.5 w-3.5" />}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button className="min-h-11 gap-1.5 sm:min-h-0" disabled={saving} onClick={() => onSave(selected)}>
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Сохранить · {selected.length}
          </Button>
          <Button variant="ghost" className="ml-auto min-h-11 sm:min-h-0" onClick={onClose}>
            Отмена
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Строка «Управляют разделом: …» — чтобы все видели, кому уходит запрос. */
export function GrokManagersLine({
  names,
  canEdit,
  onEdit,
}: {
  names: string[];
  canEdit: boolean;
  onEdit: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
      <UserCog className="h-3.5 w-3.5 shrink-0 text-primary" />
      <span className="min-w-0 flex-1">
        Доступ к закрытым аккаунтам открывают:{" "}
        <span className="text-foreground">{names.length > 0 ? names.join(", ") : "только Owner"}</span>
      </span>
      {canEdit && (
        <button
          type="button"
          onClick={onEdit}
          className="min-h-11 shrink-0 font-medium text-primary underline underline-offset-2 sm:min-h-0"
        >
          Кто управляет
        </button>
      )}
    </div>
  );
}

/** Запросы на доступ — у тех, кто вправе их решить. */
export function GrokRequestsPanel({
  requests,
  describe,
  busyId,
  onResolve,
}: {
  requests: GrokAccessRequest[];
  /**
   * Кто и к чему — НЕ из самого запроса: имя и название аккаунта в нём пишет
   * сам просящий, и подложить «Анна Петрова → Хикс тест» было бы легко.
   * Человек берётся из участников по uid, аккаунт — из витрины/аккаунта.
   */
  describe: (request: GrokAccessRequest) => { who: string; email: string | null; account: string };
  busyId: string | null;
  onResolve: (request: GrokAccessRequest, approve: boolean) => void;
}) {
  if (requests.length === 0) return null;
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-primary/35 bg-primary/[0.06] p-3">
      <p className="flex items-center gap-2 text-[12px] font-medium">
        <ShieldCheck className="h-3.5 w-3.5 text-primary" />
        Просят доступ <span className="tabular-nums opacity-70">{requests.length}</span>
      </p>
      {requests.map((request) => {
        const info = describe(request);
        return (
        <div key={request.id} className="flex flex-col gap-2 text-[12px] sm:flex-row sm:items-center">
          <p className="min-w-0 flex-1">
            <span className="font-semibold">{info.who}</span>
            {info.email && <span className="text-muted-foreground"> ({info.email})</span>}
            <span className="text-muted-foreground"> → </span>
            {info.account}
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              className="min-h-11 flex-1 gap-1.5 sm:h-8 sm:min-h-0 sm:flex-none"
              disabled={busyId === request.id}
              onClick={() => onResolve(request, true)}
            >
              {busyId === request.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Открыть доступ
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="min-h-11 flex-1 gap-1.5 sm:h-8 sm:min-h-0 sm:flex-none"
              disabled={busyId === request.id}
              onClick={() => onResolve(request, false)}
            >
              <X className="h-3.5 w-3.5" />
              Отклонить
            </Button>
          </div>
        </div>
        );
      })}
    </section>
  );
}

/**
 * Закрытые аккаунты, к которым у человека нет доступа: название без логина и
 * пароля и кнопка «Запросить доступ». Сами данные аккаунта технарь не
 * получит, пока его не впишут в список — это держат правила Firestore.
 */
export function GrokLockedAccounts({
  stubs,
  myRequests,
  showService,
  busyId,
  onRequest,
  onWithdraw,
}: {
  stubs: GrokAccessStub[];
  myRequests: Map<string, GrokAccessRequest>;
  showService: boolean;
  busyId: string | null;
  onRequest: (stub: GrokAccessStub) => void;
  onWithdraw: (request: GrokAccessRequest) => void;
}) {
  if (stubs.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Закрытые аккаунты
        <span className="tabular-nums">{stubs.length}</span>
      </h2>
      <ul className="flex flex-col gap-1.5">
        {stubs.map((stub) => {
          const request = myRequests.get(stub.id);
          const busy = busyId === stub.id;
          return (
            <li
              key={stub.id}
              className="flex flex-col gap-2 rounded-xl border border-dashed border-border/80 bg-card/40 px-3 py-2.5 sm:flex-row sm:items-center"
            >
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <Lock className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium">{stub.title}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {showService ? `${grokAppProviderLabel(stub.provider, stub.providerOther)} · ` : ""}
                    {request?.status === "pending"
                      ? "запрос отправлен — ждёт ответа"
                      : request?.status === "declined"
                        ? `в доступе отказали${request.resolvedByName ? ` (${request.resolvedByName})` : ""}`
                        : "логин и пароль видны только тем, кому открыт"}
                  </span>
                </span>
              </span>
              {request?.status === "pending" ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="min-h-11 sm:h-8 sm:min-h-0"
                  disabled={busy}
                  onClick={() => onWithdraw(request)}
                >
                  Отозвать
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-11 gap-1.5 sm:h-8 sm:min-h-0"
                  disabled={busy}
                  onClick={() => onRequest(stub)}
                >
                  {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {request?.status === "declined" ? "Запросить снова" : "Запросить доступ"}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
