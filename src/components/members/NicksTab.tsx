import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Archive, ArchiveRestore, AtSign, Link2, Loader2, Plus, Search, Unlink } from "lucide-react";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { adoptScheduleRowByNick, NickDialog } from "@/components/members/NickDialog";
import {
  addNickOption,
  linkMemberNick,
  memberNickValue,
  NICK_KIND_META,
  NICK_MAX_LENGTH,
  nickOptionsOf,
  setNickOptionInactive,
  type NickKind,
} from "@/services/memberService";
import { confirmDialog } from "@/utils/appDialog";
import { cn } from "@/utils/cn";
import { realNameOf } from "@/utils/displayName";
import { memberHasRole, type StatusOption, type Workspace, type WorkspaceMember } from "@/types";

const SECTION_TEXT: Record<NickKind, { title: string; description: string; roleHint: string }> = {
  os: {
    title: "Ники ОС",
    description:
      "Это список «Ответственный»: ник ОС стоит в заказах, по нему считаются заказы ОС и его оценки. Привяжите ник к аккаунту — и все заказы с этим ником станут его.",
    roleHint: "нет роли ОС",
  },
  tech: {
    title: "Ники технарей",
    description:
      "Технарь работает под своим ником: так его видно на «Технари», в «Заказах», «Графике» и на столах. Отдельный список — с никами ОС он не путается.",
    roleHint: "не технарь",
  },
};

/** Кто может носить ник этого вида: ОС — роль ОС; ник технаря — Технарь (или Owner, он тоже работает за столом). */
function eligibleFor(kind: NickKind, member: WorkspaceMember): boolean {
  if (member.status !== "active" || !member.uid) return false;
  return kind === "os" ? memberHasRole(member, "os") : memberHasRole(member, "manager") || member.role === "owner";
}

/**
 * Вкладка «Ники» на «Пользователи»: ники ОС и ники технарей в одном месте —
 * кто к какому нику привязан, свободные ники, люди без ника. Привязывают
 * Owner и Тимлид; Тимлид — не себе (так же держат правила).
 */
export function NicksTab({
  workspaceId,
  workspace,
  members,
  meUid,
  viewerIsOwner,
  onChanged,
}: {
  workspaceId: string;
  workspace: Workspace | null | undefined;
  members: WorkspaceMember[];
  meUid: string;
  viewerIsOwner: boolean;
  onChanged: () => Promise<void> | void;
}) {
  // Список участников в браузере не живой: освежаем его при входе на вкладку,
  // чтобы «свободен»/«занят» были правдой, а не снимком часовой давности.
  useEffect(() => {
    void onChanged();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);
  return (
    <div className="flex flex-col gap-4">
      {(["os", "tech"] as const).map((kind) => (
        <NickSection
          key={kind}
          kind={kind}
          workspaceId={workspaceId}
          options={nickOptionsOf(workspace, kind)}
          members={members}
          meUid={meUid}
          viewerIsOwner={viewerIsOwner}
          onChanged={onChanged}
        />
      ))}
    </div>
  );
}

function NickSection({
  kind,
  workspaceId,
  options,
  members,
  meUid,
  viewerIsOwner,
  onChanged,
}: {
  kind: NickKind;
  workspaceId: string;
  options: StatusOption[];
  members: WorkspaceMember[];
  meUid: string;
  viewerIsOwner: boolean;
  onChanged: () => Promise<void> | void;
}) {
  const text = SECTION_TEXT[kind];
  const [newNick, setNewNick] = useState("");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [bindOption, setBindOption] = useState<StatusOption | null>(null);
  const [nickFor, setNickFor] = useState<WorkspaceMember | null>(null);

  const boundBy = useMemo(() => {
    const map = new Map<string, WorkspaceMember>();
    for (const m of members) {
      const value = memberNickValue(m, kind);
      if (value && m.status === "active") map.set(value, m);
    }
    return map;
  }, [members, kind]);
  const active = options.filter((o) => !o.inactive);
  const inactive = options.filter((o) => o.inactive);
  const withoutNick = members
    .filter((m) => eligibleFor(kind, m) && !memberNickValue(m, kind))
    .sort((a, b) => realNameOf(a).localeCompare(realNameOf(b), "ru"));
  // Тимлид не трогает ни свой ник, ни ник Owner — так держат правила members.
  const locked = (member: WorkspaceMember) => (member.uid === meUid || member.role === "owner") && !viewerIsOwner;

  async function add() {
    const label = newNick.trim();
    if (!label) return;
    setAdding(true);
    try {
      await addNickOption({ workspaceId, kind, label });
      setNewNick("");
      toast.success(`Ник «${label}» добавлен — привяжите его к человеку, когда он придёт`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось добавить ник");
    } finally {
      setAdding(false);
    }
  }

  async function unbind(member: WorkspaceMember, option: StatusOption) {
    const ok = await confirmDialog({
      title: `Отвязать «${option.label}»?`,
      description: `${realNameOf(member)} останется без ника. Сам ник останется в списке и в заказах — его можно привязать заново или к другому человеку.`,
      confirmLabel: "Отвязать",
      destructive: true,
    });
    if (!ok) return;
    setBusy(option.value);
    try {
      await linkMemberNick({ workspaceId, uid: member.uid, kind, target: null, members });
      await onChanged();
      toast.success("Ник отвязан");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось отвязать ник");
    } finally {
      setBusy(null);
    }
  }

  async function toggleInactive(option: StatusOption) {
    setBusy(option.value);
    try {
      await setNickOptionInactive({ workspaceId, kind, value: option.value, inactive: !option.inactive });
      toast.success(option.inactive ? `«${option.label}» снова в работе` : `«${option.label}» — в неактуальных`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось изменить ник");
    } finally {
      setBusy(null);
    }
  }

  function row(option: StatusOption) {
    const owner = boundBy.get(option.value);
    const wrongRole = owner ? !eligibleFor(kind, owner) : false;
    return (
      <div key={option.value} className={cn("flex min-w-0 flex-col gap-2 rounded-lg border border-border/70 px-3 py-2 sm:flex-row sm:items-center", option.inactive && "opacity-75")}>
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: `hsl(${option.color})` }} />
          <span className="min-w-0 truncate text-sm font-medium">{option.label}</span>
          {option.inactive && <span className="shrink-0 text-[11px] text-muted-foreground">неактуальный</span>}
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          {owner ? (
            <span className="inline-flex min-w-0 items-center gap-1.5 text-[12px]">
              <MemberAvatar id={owner.uid} name={owner.name} nickname={owner.nickname} photoURL={owner.photoURL} className="h-5 w-5 shrink-0" />
              <span className="max-w-[10rem] truncate" title={owner.email}>{realNameOf(owner)}</span>
              {wrongRole && (
                <span className="inline-flex items-center gap-1 text-warning" title="Ник закреплён, а роли у человека уже нет">
                  <AlertTriangle className="h-3 w-3" />
                  {text.roleHint}
                </span>
              )}
            </span>
          ) : (
            <span className="text-[12px] text-muted-foreground">свободен</span>
          )}
          {owner ? (
            <Button
              variant="ghost"
              size="sm"
              className="min-h-11 gap-1 px-2 sm:h-7 sm:min-h-0"
              disabled={busy === option.value || locked(owner)}
              title={locked(owner) ? (owner.role === "owner" ? "Ник Owner меняет сам Owner" : "Свой ник отвязывает Owner или другой Тимлид") : undefined}
              onClick={() => void unbind(owner, option)}
            >
              <Unlink className="h-3.5 w-3.5" /> Отвязать
            </Button>
          ) : (
            <Button variant="outline" size="sm" className="min-h-11 gap-1 px-2 sm:h-7 sm:min-h-0" onClick={() => setBindOption(option)}>
              <Link2 className="h-3.5 w-3.5" /> Привязать
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="min-h-11 px-2 text-muted-foreground sm:h-7 sm:min-h-0"
            disabled={busy === option.value}
            title={option.inactive ? "Вернуть в быстрый выбор" : "Убрать из быстрого выбора — ник останется в заказах"}
            onClick={() => void toggleInactive(option)}
          >
            {busy === option.value ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : option.inactive ? (
              <ArchiveRestore className="h-3.5 w-3.5" />
            ) : (
              <Archive className="h-3.5 w-3.5" />
            )}
          </Button>
        </span>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AtSign className="h-4 w-4" /> {text.title}
          <span className="font-mono text-xs font-normal tabular-nums text-muted-foreground">{active.length}</span>
        </CardTitle>
        <CardDescription>{text.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <Input
            value={newNick}
            onChange={(e) => setNewNick(e.target.value)}
            maxLength={NICK_MAX_LENGTH}
            placeholder="Новый ник"
            className="h-9"
          />
          <Button type="submit" size="sm" variant="outline" className="min-h-11 shrink-0 gap-1.5 sm:min-h-0" disabled={!newNick.trim() || adding}>
            {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Добавить
          </Button>
        </form>

        {withoutNick.length > 0 && (
          <div className="flex flex-col gap-1.5 rounded-lg border border-dashed border-warning/40 bg-warning/[0.05] p-2.5">
            <p className="text-[12px] text-muted-foreground">Без ника · {withoutNick.length}</p>
            <div className="flex flex-wrap gap-1.5">
              {withoutNick.map((m) => (
                <button
                  key={m.uid}
                  type="button"
                  disabled={locked(m)}
                  title={locked(m) ? (m.role === "owner" ? "Ник Owner закрепляет сам Owner" : "Свой ник закрепляет Owner или другой Тимлид") : "Закрепить ник"}
                  onClick={() => setNickFor(m)}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border px-2.5 text-[12px] transition-colors hover:border-primary/50 disabled:opacity-50 sm:min-h-0 sm:py-1"
                >
                  <MemberAvatar id={m.uid} name={m.name} nickname={m.nickname} photoURL={m.photoURL} className="h-5 w-5" />
                  {realNameOf(m)}
                  <Plus className="h-3 w-3 text-primary" />
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          {active.length === 0 && <p className="text-[12px] text-muted-foreground">Ников пока нет — добавьте первый выше.</p>}
          {active.map(row)}
          {inactive.length > 0 && (
            <button
              type="button"
              onClick={() => setShowInactive((v) => !v)}
              className="flex min-h-11 items-center gap-2 self-start text-[12px] text-muted-foreground hover:text-foreground sm:min-h-0"
            >
              <Archive className="h-3.5 w-3.5" /> Неактуальные · {inactive.length}
            </button>
          )}
          {showInactive && inactive.map(row)}
        </div>
      </CardContent>

      {bindOption && (
        <BindMemberDialog
          kind={kind}
          workspaceId={workspaceId}
          option={bindOption}
          members={members}
          meUid={meUid}
          viewerIsOwner={viewerIsOwner}
          onClose={() => setBindOption(null)}
          onSaved={onChanged}
        />
      )}
      {nickFor && (
        <NickDialog
          workspaceId={workspaceId}
          kind={kind}
          member={nickFor}
          members={members}
          options={options}
          onClose={() => setNickFor(null)}
          onSaved={onChanged}
        />
      )}
    </Card>
  );
}

/** Привязать свободный ник к человеку. У кого уже есть ник этого вида — он заменится. */
function BindMemberDialog({
  kind,
  workspaceId,
  option,
  members,
  meUid,
  viewerIsOwner,
  onClose,
  onSaved,
}: {
  kind: NickKind;
  workspaceId: string;
  option: StatusOption;
  members: WorkspaceMember[];
  meUid: string;
  viewerIsOwner: boolean;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const q = query.trim().toLowerCase();
  const people = members
    .filter((m) => eligibleFor(kind, m))
    .filter((m) => !q || `${realNameOf(m)} ${m.name} ${m.techNick ?? ""} ${m.email ?? ""}`.toLowerCase().includes(q))
    .sort((a, b) => realNameOf(a).localeCompare(realNameOf(b), "ru"));

  async function bind(member: WorkspaceMember) {
    setSaving(member.uid);
    try {
      await linkMemberNick({ workspaceId, uid: member.uid, kind, target: { optionValue: option.value }, members });
      const adopted = await adoptScheduleRowByNick({ workspaceId, memberUid: member.uid, nickLabel: option.label, actorUid: meUid });
      toast.success(`«${option.label}» привязан`, {
        description: adopted ? `${realNameOf(member)} · график «${adopted}» перенесён на аккаунт` : realNameOf(member),
      });
      onClose();
      await Promise.resolve(onSaved()).catch(() => undefined);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось привязать ник");
    } finally {
      setSaving(null);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Привязать «{option.label}»</DialogTitle>
          <DialogDescription>
            {kind === "os"
              ? "К кому из ОС относится этот ник. Все заказы с ним станут заказами этого человека."
              : "Какой технарь работает под этим ником."}
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Найти человека" className="pl-8" />
        </div>
        <div className="flex max-h-72 flex-col gap-0.5 overflow-y-auto">
          {people.length === 0 && (
            <p className="py-6 text-center text-[12px] text-muted-foreground">
              Нет подходящих людей — {kind === "os" ? "нужна роль ОС" : "нужна роль Технарь"}.
            </p>
          )}
          {people.map((m) => {
            const current = memberNickValue(m, kind);
            const currentLabel = current ? (m[NICK_KIND_META[kind].label] as string | undefined) : null;
            const selfLocked = (m.uid === meUid || m.role === "owner") && !viewerIsOwner;
            return (
              <button
                key={m.uid}
                type="button"
                disabled={Boolean(saving) || selfLocked}
                onClick={() => void bind(m)}
                className="flex min-h-11 min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent disabled:opacity-50"
              >
                <MemberAvatar id={m.uid} name={m.name} nickname={m.nickname} photoURL={m.photoURL} className="h-7 w-7 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{realNameOf(m)}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {selfLocked
                      ? m.role === "owner"
                        ? "ник Owner закрепляет сам Owner"
                        : "свой ник закрепляет Owner или другой Тимлид"
                      : [m.email, currentLabel ? `сейчас: ${currentLabel} — заменится` : null].filter(Boolean).join(" · ")}
                  </span>
                </span>
                {saving === m.uid && <Loader2 className="h-4 w-4 animate-spin" />}
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
