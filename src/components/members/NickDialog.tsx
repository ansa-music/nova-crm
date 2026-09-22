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
import {
  linkMemberNick,
  memberNickValue,
  NICK_KIND_META,
  NICK_MAX_LENGTH,
  type NickKind,
  type NickTarget,
} from "@/services/memberService";
import { confirmDialog } from "@/utils/appDialog";
import { cn } from "@/utils/cn";
import { realNameOf } from "@/utils/displayName";
import { splitOptionsByActivity } from "@/utils/columnOptions";
import type { StatusOption, WorkspaceMember } from "@/types";

export type NickChoice = { kind: "option"; value: string } | { kind: "new"; label: string };

export function nickChoiceToTarget(choice: NickChoice): NickTarget {
  return choice.kind === "option" ? { optionValue: choice.value } : { newNick: choice.label };
}

/**
 * Подобрать выбор по нику, который человек написал сам (в заявке): есть в
 * списке и свободен — берём его, иначе — «новый ник с таким именем».
 */
export function suggestNickChoice(
  nick: string | undefined | null,
  options: StatusOption[],
  kind: NickKind,
  members: WorkspaceMember[],
  selfUid?: string
): NickChoice | null {
  const label = nick?.trim().slice(0, NICK_MAX_LENGTH) ?? "";
  if (!label) return null;
  const option = options.find((o) => o.label.trim().toLowerCase() === label.toLowerCase());
  if (!option) return { kind: "new", label };
  const takenBy = members.find((m) => m.uid !== selfUid && memberNickValue(m, kind) === option.value);
  return takenBy ? null : { kind: "option", value: option.value };
}

/**
 * Список ников с поиском: выбрать существующий (занятые другими — видны, но
 * недоступны), раскрыть «неактуальные» или завести новый. Ничего не пишет —
 * только выбор; сохраняют NickDialog и одобрение заявки.
 */
export function NickPicker({
  kind,
  options,
  members,
  selfUid,
  currentValue,
  choice,
  onChoice,
  initialQuery = "",
}: {
  kind: NickKind;
  options: StatusOption[];
  members: WorkspaceMember[];
  /** Чей ник выбираем — его собственный ник «занятым» не считается. */
  selfUid?: string;
  currentValue: string | null;
  choice: NickChoice | null;
  onChoice: (choice: NickChoice) => void;
  initialQuery?: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [showInactive, setShowInactive] = useState(false);
  const meta = NICK_KIND_META[kind];

  const pinnedBy = useMemo(() => {
    const map = new Map<string, WorkspaceMember>();
    for (const m of members) {
      const value = memberNickValue(m, kind);
      if (m.uid !== selfUid && value) map.set(value, m);
    }
    return map;
  }, [members, selfUid, kind]);

  const q = query.trim().toLowerCase();
  const split = splitOptionsByActivity(options, [currentValue, choice?.kind === "option" ? choice.value : null]);
  const match = (list: StatusOption[]) => (q ? list.filter((o) => o.label.toLowerCase().includes(q)) : list);
  const visible = match(split.active);
  const visibleInactive = match(split.inactive);
  const exact = q ? options.find((o) => o.label.trim().toLowerCase() === q) : undefined;
  const newLabel = query.trim().slice(0, NICK_MAX_LENGTH);

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Найти или ввести новый ник"
          maxLength={NICK_MAX_LENGTH}
          className="pl-8"
          autoComplete="off"
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
            e.preventDefault();
            if (exact && !pinnedBy.has(exact.value)) onChoice({ kind: "option", value: exact.value });
            else if (!exact && newLabel) onChoice({ kind: "new", label: newLabel });
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
              onClick={() => onChoice({ kind: "option", value: option.value })}
              className={cn(
                "flex min-h-11 w-full min-w-0 items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors sm:min-h-0",
                selected ? "bg-primary/15 text-foreground" : "hover:bg-accent",
                option.inactive && !selected && "opacity-70",
                owner && "cursor-not-allowed opacity-50 hover:bg-transparent"
              )}
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: `hsl(${option.color})` }} />
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {owner ? (
                <span className="max-w-[45%] shrink-0 truncate text-[11px] text-muted-foreground">занят: {realNameOf(owner)}</span>
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
            className="flex min-h-11 w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:min-h-0"
          >
            <Archive className="h-3.5 w-3.5 shrink-0" />
            Неактуальные ники · {visibleInactive.length}
          </button>
        )}

        {!exact && newLabel && (
          <button
            type="button"
            onClick={() => onChoice({ kind: "new", label: newLabel })}
            className={cn(
              "flex min-h-11 w-full min-w-0 items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors sm:min-h-0",
              choice?.kind === "new" && choice.label === newLabel ? "bg-primary/15" : "hover:bg-accent"
            )}
          >
            <Plus className="h-3.5 w-3.5 shrink-0 text-primary" />
            <span className="min-w-0 flex-1 truncate">
              Новый ник «<span className="font-medium">{newLabel}</span>» — добавить в {meta.listName}
            </span>
            {choice?.kind === "new" && choice.label === newLabel && <Check className="h-4 w-4 shrink-0 text-primary" />}
          </button>
        )}

        {options.length === 0 && !newLabel && (
          <p className="px-2.5 py-3 text-xs text-muted-foreground">Список {meta.listName} пуст — введите ник выше, он добавится.</p>
        )}
        {options.length > 0 && visible.length === 0 && !newLabel && (
          <p className="px-2.5 py-3 text-xs text-muted-foreground">Ничего не нашли.</p>
        )}
      </div>
      {choice?.kind === "new" && (
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <AtSign className="h-3 w-3 shrink-0" />
          Новый ник «{choice.label}» появится в {meta.listName} при сохранении.
        </p>
      )}
    </div>
  );
}

const KIND_TEXT: Record<NickKind, { title: string; description: string; unpin: string }> = {
  os: {
    title: "Ник ОС",
    description:
      "Выберите ник из списка «Ответственный» — заказы, где технари уже поставили этот ник, сразу станут заказами этого ОС. По ним он видит свои заказы на «Технари» и может оценить технаря.",
    unpin: "ник останется в списке «Ответственный» и в заказах, но новые оценки этот ОС ставить не сможет, пока ник снова не закрепят.",
  },
  tech: {
    title: "Ник технаря",
    description:
      "Технарь работает под этим ником: так его видно на «Технари», в «Заказах», «Графике» и на столах. Ник живёт в своём списке и не путается с никами ОС.",
    unpin: "ник останется в списке «Ники технарей» свободным, технаря снова будут показывать по его имени.",
  },
};

/** Закрепить за участником ник (ОС или технаря) или открепить его. Тимлид/Owner only. */
export function NickDialog({
  workspaceId,
  kind,
  member,
  members,
  options,
  onClose,
  onSaved,
}: {
  workspaceId: string;
  kind: NickKind;
  member: WorkspaceMember;
  members: WorkspaceMember[];
  options: StatusOption[];
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const value = memberNickValue(member, kind);
  const currentValue = value && options.some((o) => o.value === value) ? value : null;
  const [choice, setChoice] = useState<NickChoice | null>(currentValue ? { kind: "option", value: currentValue } : null);
  const [saving, setSaving] = useState(false);
  // Настоящее имя, а не ник: у технаря с ником иначе вышло бы «Ник технаря · Sako».
  const name = realNameOf(member);
  const text = KIND_TEXT[kind];
  // Ник, который удалили из списка, возвращается под старым value.
  const savedLabel = (member[NICK_KIND_META[kind].label] as string | undefined)?.trim() ?? "";
  const lostNick = value && !currentValue ? savedLabel : "";
  const unchanged = choice?.kind === "option" && choice.value === currentValue;

  async function handleSave() {
    if (!choice || unchanged) return;
    setSaving(true);
    try {
      await linkMemberNick({ workspaceId, uid: member.uid, kind, target: nickChoiceToTarget(choice), members });
      const label = choice.kind === "option" ? options.find((o) => o.value === choice.value)?.label ?? "" : choice.label;
      await onSaved();
      toast.success(`${text.title} «${label}» закреплён`, { description: name });
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось закрепить ник");
    } finally {
      setSaving(false);
    }
  }

  async function handleUnpin() {
    const ok = await confirmDialog({
      title: `Открепить ${text.title.toLowerCase()}?`,
      description: `${name}: ${text.unpin}`,
      confirmLabel: "Открепить",
      destructive: true,
    });
    if (!ok) return;
    setSaving(true);
    try {
      await linkMemberNick({ workspaceId, uid: member.uid, kind, target: null, members });
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
          <DialogTitle>
            {text.title} · {name}
          </DialogTitle>
          <DialogDescription>{text.description}</DialogDescription>
        </DialogHeader>

        <NickPicker
          kind={kind}
          options={options}
          members={members}
          selfUid={member.uid}
          currentValue={currentValue}
          choice={choice}
          onChoice={setChoice}
        />
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

        <DialogFooter className="gap-2 sm:justify-between">
          {value ? (
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
