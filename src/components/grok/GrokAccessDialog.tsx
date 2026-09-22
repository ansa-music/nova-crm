import { useMemo, useState } from "react";
import { Loader2, Search, ShieldCheck } from "lucide-react";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/utils/cn";
import { personLabel } from "@/utils/peopleDesks";
import { memberHasRole, type WorkspaceMember } from "@/types";

/**
 * Кому открыт аккаунт подписки. Owner и Тимлид в списке не нужны — они видят
 * все аккаунты всегда; отметить их всё равно нечем.
 *
 * Пустой список = аккаунт снова открыт всем: «закрыт и никому не открыт» —
 * состояние, в котором аккаунт просто исчезает у всех, и заводить его
 * случайным кликом незачем.
 */
export function GrokAccessDialog({
  title,
  members,
  allowedUids,
  saving,
  onClose,
  onSave,
}: {
  title: string;
  members: WorkspaceMember[];
  allowedUids: string[];
  saving: boolean;
  onClose: () => void;
  onSave: (uids: string[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>(allowedUids);
  const [search, setSearch] = useState("");

  const people = useMemo(() => {
    const q = search.trim().toLowerCase();
    return members
      .filter((m) => m.status === "active" && Boolean(m.uid) && m.role !== "owner" && m.role !== "teamlead")
      .filter((m) => !q || `${personLabel(m)} ${m.email ?? ""}`.toLowerCase().includes(q))
      .sort((a, b) => personLabel(a).localeCompare(personLabel(b), "ru"));
  }, [members, search]);

  function toggle(uid: string) {
    setSelected((prev) => (prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid]));
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 shrink-0 text-primary" />
            Доступ к аккаунту
          </DialogTitle>
          <DialogDescription>
            {title}. Отмеченные видят аккаунт в «Грок лимите»; если не отмечен никто — аккаунт открыт всем. Остальные видят
            только название и могут запросить доступ. Owner, Тимлид и те, кто управляет разделом, видят его всегда.
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
                  <span className="block truncate text-[13px]">{personLabel(member) || member.email}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {memberHasRole(member, "manager") ? "Технарь" : memberHasRole(member, "os") ? "ОС" : member.email}
                  </span>
                </span>
                <span
                  className={cn(
                    "shrink-0 rounded-md border px-1.5 py-0.5 text-[10px]",
                    on ? "border-primary/45 text-primary" : "border-border/60 text-muted-foreground"
                  )}
                >
                  {on ? "есть доступ" : "нет"}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button className="min-h-11 gap-1.5 sm:min-h-0" disabled={saving} onClick={() => onSave(selected)}>
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Сохранить
            {selected.length > 0 && <span className="tabular-nums opacity-80">{selected.length}</span>}
          </Button>
          {selected.length > 0 && (
            <Button variant="ghost" className="min-h-11 sm:min-h-0" disabled={saving} onClick={() => setSelected([])}>
              Открыть всем
            </Button>
          )}
          <Button variant="ghost" className="ml-auto min-h-11 sm:min-h-0" disabled={saving} onClick={onClose}>
            Отмена
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
