import { useMemo, useState } from "react";
import { Archive, AtSign, Check, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { linkMemberOsNick, OS_NICK_MAX_LENGTH } from "@/services/memberService";
import { bindScheduleGroupPersonToMember } from "@/services/scheduleGroupService";
import { usePermissions } from "@/hooks/usePermissions";
import { confirmDialog } from "@/utils/appDialog";
import { cn } from "@/utils/cn";
import { displayNameOf } from "@/utils/displayName";
import { splitOptionsByActivity } from "@/utils/columnOptions";
import type { StatusOption, WorkspaceMember } from "@/types";

type Choice = { kind: "option"; value: string } | { kind: "new"; label: string };

/**
 * Тимлид/Owner pins an ОС account to its nick. Nicks usually already sit in
 * the shared «Ответственный» list (and on orders) before the person gets an
 * account — so picking one comes first; a new nick is appended to the list.
 * Nothing in the list is ever renamed or removed from here.
 */
export function OsNickDialog({
  workspaceId,
  member,
  members,
  options,
  onClose,
  onSaved,
}: {
  workspaceId: string;
  member: WorkspaceMember;
  members: WorkspaceMember[];
  options: StatusOption[];
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const { uid: actorUid } = usePermissions();
  const currentValue = member.osNickValue && options.some((o) => o.value === member.osNickValue) ? member.osNickValue : null;
  const [query, setQuery] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [choice, setChoice] = useState<Choice | null>(currentValue ? { kind: "option", value: currentValue } : null);
  const [saving, setSaving] = useState(false);
  const name = displayNameOf(member);

  const pinnedBy = useMemo(() => {
    const map = new Map<string, WorkspaceMember>();
    for (const m of members) if (m.uid !== member.uid && m.osNickValue) map.set(m.osNickValue, m);
    return map;
  }, [members, member.uid]);

  const q = query.trim().toLowerCase();
  // Ушедший ОС из быстрого списка уходит, но не из природы: ник остаётся в
  // заказах, и закрепить его заново (или на другого человека) можно —
  // раскрыв «Неактуальные».
  const split = splitOptionsByActivity(options, [currentValue]);
  const match = (list: StatusOption[]) => (q ? list.filter((o) => o.label.toLowerCase().includes(q)) : list);
  const visible = match(split.active);
  const visibleInactive = match(split.inactive);
  const exact = q ? options.find((o) => o.label.trim().toLowerCase() === q) : undefined;
  const newLabel = query.trim().slice(0, OS_NICK_MAX_LENGTH);
  // A nick the Owner deleted from the list comes back under its old value.
  const lostNick = member.osNickValue && !currentValue ? member.osNick?.trim() ?? "" : "";

  const unchanged = choice?.kind === "option" && choice.value === currentValue;

  async function handleSave() {
    if (!choice || unchanged) return;
    setSaving(true);
    try {
      const target = choice.kind === "option" ? { optionValue: choice.value } : { newNick: choice.label };
      await linkMemberOsNick({ workspaceId, uid: member.uid, target, members });
      const label = choice.kind === "option" ? options.find((o) => o.value === choice.value)?.label ?? "" : choice.label;
      // График могли завести заранее — на «ожидающего» человека с этим ником.
      // Теперь у него есть аккаунт: переносим строку графика на него.
      const adopted = await bindScheduleGroupPersonToMember({
        workspaceId,
        memberUid: member.uid,
        osNickLabel: label,
        actorUid,
      }).catch(() => null);
      await onSaved();
      toast.success(`Ник ОС «${label}» закреплён`, {
        description: adopted ? `${name} · график «${adopted}» перенесён на аккаунт` : name,
      });
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось закрепить ник");
    } finally {
      setSaving(false);
    }
  }

  async function handleUnpin() {
    const ok = await confirmDialog({
      title: "Открепить ник ОС?",
      description: `${name}: ник останется в списке «Ответственный» и в заказах, но новые оценки этот ОС ставить не сможет, пока ник снова не закрепят.`,
      confirmLabel: "Открепить",
      destructive: true,
    });
    if (!ok) return;
    setSaving(true);
    try {
      await linkMemberOsNick({ workspaceId, uid: member.uid, target: null, members });
      await onSaved();
      toast.success("Ник откреплён");
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось открепить ник");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Ник ОС · {name}</DialogTitle>
          <DialogDescription>
            Выберите ник из списка «Ответственный» — заказы, где технари уже поставили этот ник, сразу станут заказами
            этого ОС. По ним он видит свои заказы на «Технари» и может оценить технаря.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-w-0 flex-col gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Найти или ввести новый ник"
              maxLength={OS_NICK_MAX_LENGTH}
              className="pl-8"
              autoComplete="off"
              onKeyDown={(e) => {
                if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
                e.preventDefault();
                if (exact && !pinnedBy.has(exact.value)) setChoice({ kind: "option", value: exact.value });
                else if (!exact && newLabel) setChoice({ kind: "new", label: newLabel });
              }}
            />
          </div>

          <div className="max-h-64 min-h-[3rem] overflow-y-auto rounded-lg border border-border/70 p-1">
            {[...visible, ...(showInactive ? visibleInactive : [])].map((option) => {
              const owner = pinnedBy.get(option.value);
              const selected = choice?.kind === "option" && choice.value === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  disabled={Boolean(owner)}
                  onClick={() => setChoice({ kind: "option", value: option.value })}
                  className={cn(
                    "flex w-full min-w-0 items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors",
                    selected ? "bg-primary/15 text-foreground" : "hover:bg-accent",
                    option.inactive && !selected && "opacity-70",
                    owner && "cursor-not-allowed opacity-50 hover:bg-transparent"
                  )}
                >
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: `hsl(${option.color})` }} />
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  {owner ? (
                    <span className="max-w-[45%] shrink-0 truncate text-[11px] text-muted-foreground">занят: {displayNameOf(owner)}</span>
                  ) : option.value === currentValue ? (
                    <span className="shrink-0 text-[11px] text-primary">сейчас</span>
                  ) : option.inactive ? (
                    <span className="shrink-0 text-[11px] text-muted-foreground">неактуальный</span>
                  ) : null}
                  {selected && <Check className="h-4 w-4 shrink-0 text-primary" />}
                </button>
              );
            })}

            {visibleInactive.length > 0 && !showInactive && (
              <button
                type="button"
                onClick={() => setShowInactive(true)}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <Archive className="h-3.5 w-3.5 shrink-0" />
                Неактуальные ники · {visibleInactive.length}
              </button>
            )}

            {!exact && newLabel && (
              <button
                type="button"
                onClick={() => setChoice({ kind: "new", label: newLabel })}
                className={cn(
                  "flex w-full min-w-0 items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors",
                  choice?.kind === "new" && choice.label === newLabel ? "bg-primary/15" : "hover:bg-accent"
                )}
              >
                <Plus className="h-3.5 w-3.5 shrink-0 text-primary" />
                <span className="min-w-0 flex-1 truncate">
                  Новый ник «<span className="font-medium">{newLabel}</span>» — добавить в «Ответственный»
                </span>
                {choice?.kind === "new" && choice.label === newLabel && <Check className="h-4 w-4 shrink-0 text-primary" />}
              </button>
            )}

            {options.length === 0 && !newLabel && (
              <p className="px-2.5 py-3 text-xs text-muted-foreground">
                Список «Ответственный» пуст — введите ник выше, он добавится в список.
              </p>
            )}
            {options.length > 0 && visible.length === 0 && !newLabel && (
              <p className="px-2.5 py-3 text-xs text-muted-foreground">Ничего не нашли.</p>
            )}
          </div>

          {lostNick && (
            <button
              type="button"
              onClick={() => setChoice({ kind: "new", label: lostNick })}
              className="inline-flex items-center gap-1.5 self-start text-xs text-warning hover:underline"
            >
              <AtSign className="h-3 w-3" />
              Ник «{lostNick}» удалён из списка — вернуть его
            </button>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {member.osNickValue ? (
            <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => void handleUnpin()} disabled={saving}>
              Открепить
            </Button>
          ) : (
            <span />
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="outline" onClick={onClose} disabled={saving}>
              Отмена
            </Button>
            <Button onClick={() => void handleSave()} disabled={saving || !choice || unchanged}>
              Закрепить
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
