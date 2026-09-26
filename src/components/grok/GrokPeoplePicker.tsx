import { useMemo, useState, type ReactNode } from "react";
import { Search, UserX } from "lucide-react";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { cn } from "@/utils/cn";
import { groupPickerPeople } from "@/utils/grokPeople";
import { personLabel } from "@/utils/peopleDesks";
import { memberHasRole, type WorkspaceMember } from "@/types";
import type { TeamGroup } from "@/utils/teamGroup";

/**
 * Пикер людей «Грок лимита» — общий для «Доступа к аккаунту» и «Кто
 * управляет разделом». Люди по группам «Технари / ОС / Другие» (как на
 * «Команде»), у группы «все / снять», поиск по началам слов имени, ника и
 * почты, строка — галочка + аватар + имя. Кандидатов и группы считает
 * `utils/grokPeople.ts`; здесь только разметка.
 */
export function GrokPeoplePicker({
  candidates,
  selected,
  onChange,
  disabled = false,
  badges,
  groupOrder,
}: {
  candidates: WorkspaceMember[];
  selected: string[];
  onChange: (next: string[]) => void;
  /** Список приглушён и не правится (аккаунт «открыт всем»). */
  disabled?: boolean;
  /** Подпись справа у человека: «просит доступ». */
  badges?: Record<string, string>;
  /** Порядок групп (по умолчанию «Технари / ОС / Другие», как на «Команде»). */
  groupOrder?: readonly TeamGroup[];
}) {
  const [search, setSearch] = useState("");
  const groups = useMemo(() => groupPickerPeople(candidates, search, groupOrder), [candidates, search, groupOrder]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const shownCount = groups.reduce((n, g) => n + g.people.length, 0);

  function toggle(uid: string) {
    if (disabled) return;
    onChange(selectedSet.has(uid) ? selected.filter((id) => id !== uid) : [...selected, uid]);
  }
  function setGroup(uids: string[], on: boolean) {
    if (disabled) return;
    const set = new Set(selected);
    for (const uid of uids) (on ? set.add(uid) : set.delete(uid));
    onChange(Array.from(set));
  }

  return (
    <div className={cn("flex flex-col gap-3", disabled && "pointer-events-none opacity-50")} aria-disabled={disabled}>
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Имя, ник или почта"
            aria-label="Поиск по людям"
            className="h-9 pl-8"
            disabled={disabled}
          />
        </div>
        {selected.length > 0 && (
          <Button variant="ghost" size="sm" className="h-9 shrink-0 gap-1 px-2 text-xs text-muted-foreground" onClick={() => onChange([])} disabled={disabled}>
            <UserX className="h-3.5 w-3.5" /> снять всех
          </Button>
        )}
      </div>

      {candidates.length === 0 && <p className="py-6 text-center text-[12px] text-muted-foreground">Отмечать некого — никто, кроме руководства, ещё не пришёл.</p>}
      {candidates.length > 0 && shownCount === 0 && <p className="py-6 text-center text-[12px] text-muted-foreground">Никого не нашли.</p>}

      {groups.map((group) => {
        if (group.people.length === 0) return null;
        const picked = group.all.filter((m) => selectedSet.has(m.uid)).length;
        const allOn = picked === group.all.length;
        return (
          <section key={group.id} className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2 px-1 pb-1">
              <p className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {group.label} <span className="font-normal normal-case tracking-normal">· {picked} из {group.all.length}</span>
              </p>
              <button
                type="button"
                className="min-h-8 shrink-0 text-[12px] font-medium text-primary hover:underline disabled:opacity-40"
                disabled={disabled || allOn}
                onClick={() => setGroup(group.all.map((m) => m.uid), true)}
              >
                все
              </button>
              <button
                type="button"
                className="min-h-8 shrink-0 text-[12px] text-muted-foreground hover:underline disabled:opacity-40"
                disabled={disabled || picked === 0}
                onClick={() => setGroup(group.all.map((m) => m.uid), false)}
              >
                снять
              </button>
            </div>
            {group.people.map((member) => {
              const on = selectedSet.has(member.uid);
              const badge = badges?.[member.uid];
              const sub = memberHasRole(member, "manager") ? "Технарь" : memberHasRole(member, "os") ? "ОС" : member.email;
              return (
                <label
                  key={member.uid}
                  className={cn(
                    "flex min-h-11 cursor-pointer items-center gap-2.5 rounded-md px-2 py-1 transition-colors hover:bg-muted/60 sm:min-h-9",
                    on && "bg-primary/[0.07]",
                    badge && !on && "bg-warning/[0.08]"
                  )}
                >
                  <Checkbox checked={on} onCheckedChange={() => toggle(member.uid)} aria-label={personLabel(member)} disabled={disabled} />
                  <MemberAvatar id={member.uid} name={member.name} nickname={member.nickname} photoURL={member.photoURL} className="h-6 w-6 shrink-0 text-[10px]" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px]">{personLabel(member) || member.email}</span>
                    {sub && sub !== personLabel(member) && <span className="block truncate text-[11px] text-muted-foreground">{sub}</span>}
                  </span>
                  {badge && (
                    <span className="shrink-0 rounded-md border border-warning/40 bg-warning/[0.12] px-1.5 py-0.5 text-[10px] font-medium text-warning">{badge}</span>
                  )}
                </label>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}

/**
 * Оболочка окна пикера: на телефоне — лист снизу (список длинный, так
 * удобнее большим пальцем), на десктопе — диалог `max-w-md`. Тело
 * прокручивается, шапка и футер стоят на месте.
 */
export function GrokPickerShell({
  icon,
  title,
  description,
  onClose,
  children,
  footer,
}: {
  icon: ReactNode;
  title: ReactNode;
  description: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
}) {
  const mobile = useIsMobile();
  if (mobile) {
    return (
      <Sheet open onOpenChange={(open) => !open && onClose()}>
        <SheetContent side="bottom" hideClose className="flex max-h-[92dvh] flex-col gap-0 p-0 pb-[env(safe-area-inset-bottom)]">
          <SheetHeader className="px-4 pt-1">
            <SheetTitle className="flex items-center gap-2">
              {icon}
              {title}
            </SheetTitle>
            <SheetDescription className="text-[12px]">{description}</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">{children}</div>
          <div className="flex items-center gap-2 border-t border-border px-4 py-3">{footer}</div>
        </SheetContent>
      </Sheet>
    );
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md gap-0 p-0">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle className="flex items-center gap-2">
            {icon}
            {title}
          </DialogTitle>
          <DialogDescription className="text-[12px]">{description}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto px-5 py-4">{children}</div>
        <div className="flex items-center gap-2 border-t border-border px-6 py-4">{footer}</div>
      </DialogContent>
    </Dialog>
  );
}
