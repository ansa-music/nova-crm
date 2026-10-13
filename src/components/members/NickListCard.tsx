import { useMemo, useState } from "react";
import { AlertTriangle, Archive, ArchiveRestore, AtSign, Link2, Loader2, Pencil, Plus, Search, Unlink } from "lucide-react";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { adoptScheduleRowByNick } from "@/components/members/NickDialog";
import { desksNamedAfterNick, RenameNickDialog, renameNickWithDesks } from "@/components/members/RenameNickDialog";
import {
  addNickOption,
  linkMemberNick,
  memberNickValue,
  NICK_MAX_LENGTH,
  setNickOptionInactive,
  type NickKind,
} from "@/services/memberService";
import { confirmDialog } from "@/utils/appDialog";
import { firestoreErrorText } from "@/utils/dbError";
import { cn } from "@/utils/cn";
import { realNameOf } from "@/utils/displayName";
import { canHoldNick, nickLockedFor, nickLockReason } from "@/utils/teamGroup";
import type { StatusOption, WorkspaceMember, WorkspacePage } from "@/types";
import { useWorkspace } from "@/hooks/useWorkspace";
import { setPageInactive } from "@/services/pageService";
import { worksAsTechnician } from "@/utils/peopleDesks";

const LIST_TEXT: Record<NickKind, { title: string; description: string; roleHint: string; bindHint: string; nobody: string }> = {
  os: {
    title: "Ники ОС",
    description:
      "Это список «Ответственный»: ник ОС стоит в заказах, по нему считаются заказы ОС и его оценки. Привяжите ник к аккаунту — и все заказы с этим ником станут его.",
    roleHint: "нет роли ОС",
    bindHint: "К кому из ОС относится этот ник. Все заказы с ним станут заказами этого человека.",
    nobody: "нужна роль ОС",
  },
  tech: {
    title: "Ники технарей",
    description:
      "Технарь работает под своим ником: так его видно на «Технари», в «Заказах», «Графике» и на столах. Отдельный список — с никами ОС он не путается.",
    roleHint: "не в «Технарях»",
    bindHint: "Какой технарь работает под этим ником.",
    nobody: "нужна роль Технарь",
  },
  other: {
    title: "Ники: другие",
    description:
      "Ники для Owner, Admin, Тимлидов без второй роли и Viewer. Подписывают человека так же, как ник технаря, но живут в своём списке.",
    roleHint: "не в «Других»",
    bindHint: "Кого из раздела «Другие» подписывать этим ником.",
    nobody: "в разделе «Другие» никого нет",
  },
};

/**
 * Список ников одного вида на «Команде»: кто к какому нику привязан,
 * свободные ники, «Привязать» / «Отвязать» / переименовать / «В
 * неактуальные». Кто остался без ника — видно в карточке людей раздела,
 * здесь это не дублируется. Привязывают и переименовывают Owner и Тимлид;
 * Тимлид — не себе и не Owner (так же держат правила).
 */
export function NickListCard({
  kind,
  workspaceId,
  options,
  members,
  meUid,
  viewerIsOwner,
  viewerIsCreator = false,
  query,
  onChanged,
}: {
  kind: NickKind;
  workspaceId: string;
  options: StatusOption[];
  members: WorkspaceMember[];
  meUid: string;
  viewerIsOwner: boolean;
  /** Создатель workspace: только он трогает записи других Owner. */
  viewerIsCreator?: boolean;
  /** Поиск страницы — фильтрует и ники (по подписи и по держателю). */
  query: string;
  onChanged: () => Promise<void> | void;
}) {
  const text = LIST_TEXT[kind];
  const [newNick, setNewNick] = useState("");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [bindOption, setBindOption] = useState<StatusOption | null>(null);
  const [renameOption, setRenameOption] = useState<StatusOption | null>(null);
  const { allPages } = useWorkspace();

  const boundBy = useMemo(() => {
    const map = new Map<string, WorkspaceMember>();
    for (const m of members) {
      const value = memberNickValue(m, kind);
      if (value && m.status === "active") map.set(value, m);
    }
    return map;
  }, [members, kind]);
  const q = query.trim().toLowerCase();
  const matches = (option: StatusOption) => {
    if (!q) return true;
    const owner = boundBy.get(option.value);
    return `${option.label} ${owner ? `${realNameOf(owner)} ${owner.name} ${owner.email ?? ""}` : ""}`.toLowerCase().includes(q);
  };
  const activeAll = options.filter((o) => !o.inactive);
  const active = activeAll.filter(matches);
  const inactive = options.filter((o) => o.inactive).filter(matches);
  const freeCount = activeAll.filter((o) => !boundBy.has(o.value)).length;

  async function add() {
    const label = newNick.trim();
    if (!label) return;
    setAdding(true);
    try {
      await addNickOption({ workspaceId, kind, label });
      setNewNick("");
      toast.success(`Ник «${label}» добавлен — привяжите его к человеку, когда он придёт`);
      // Счётчики «свободных» и «без ника» считаются по участникам — без этого
      // они оставались вчерашними до следующего захода на страницу.
      await Promise.resolve(onChanged()).catch(() => undefined);
    } catch (error) {
      toast.error("Не удалось добавить ник", { description: firestoreErrorText(error, "База не приняла запись") });
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
      toast.success("Ник отвязан");
      await Promise.resolve(onChanged()).catch(() => undefined);
    } catch (error) {
      toast.error("Не удалось отвязать ник", { description: firestoreErrorText(error, "База не приняла запись") });
    } finally {
      setBusy(null);
    }
  }

  /**
   * Столы человека, который держит этот ник (просьба Nurba 12.10.2026: «ник
   * уходит в неактуальные — его стол тоже»): ник технаря → его столы, ник ОС →
   * его стол ОС. Держателя ищем среди всех участников, не только активных —
   * у неактуального ника человек часто уже убран из команды. У ника «Другие»
   * столов нет; столы Owner не трогаем.
   */
  function desksOf(option: StatusOption): { holder: WorkspaceMember; desks: WorkspacePage[] } | null {
    if (kind === "other") return null;
    const holder = boundBy.get(option.value) ?? members.find((m) => m.uid && memberNickValue(m, kind) === option.value);
    if (!holder?.uid || holder.role === "owner") return null;
    const desks = allPages.filter(
      (p) => !p.inactive && p.responsibleUserId === holder.uid && (kind === "os" ? Boolean(p.osDesk) : !p.osDesk)
    );
    return desks.length > 0 ? { holder, desks } : null;
  }

  /** Убрать столы в «Неактуальные». Ошибка одного стола не останавливает остальные. */
  async function retireDesks(found: { holder: WorkspaceMember; desks: WorkspacePage[] }): Promise<{ done: number; failed: number }> {
    let done = 0;
    let failed = 0;
    for (const page of found.desks) {
      try {
        await setPageInactive(workspaceId, page, true, meUid, worksAsTechnician(found.holder));
        done++;
      } catch {
        failed++;
      }
    }
    return { done, failed };
  }

  // Ники уже в неактуальных, а столы их людей ещё в работе — разовая уборка кнопкой.
  const staleDesks = options
    .filter((o) => o.inactive)
    .map(desksOf)
    .filter((f): f is { holder: WorkspaceMember; desks: WorkspacePage[] } => f !== null);
  const staleCount = staleDesks.reduce((sum, f) => sum + f.desks.length, 0);

  async function retireStaleDesks() {
    const names = staleDesks.flatMap((f) => f.desks.map((p) => `«${p.name}»`));
    const ok = await confirmDialog({
      title: `Убрать в неактуальные столы неактуальных ников (${staleCount})?`,
      description: `${names.slice(0, 8).join(", ")}${names.length > 8 ? ` и ещё ${names.length - 8}` : ""}. Ничего не удаляется — стол можно вернуть из «Неактуальных».`,
      confirmLabel: "Убрать столы",
    });
    if (!ok) return;
    setBusy("__stale__");
    try {
      let done = 0;
      let failed = 0;
      for (const found of staleDesks) {
        const r = await retireDesks(found);
        done += r.done;
        failed += r.failed;
      }
      if (failed > 0) toast.warning(`В неактуальные ушло столов: ${done}, не удалось: ${failed}`);
      else toast.success(`В неактуальные ушло столов: ${done}`);
    } finally {
      setBusy(null);
    }
  }

  async function toggleInactive(option: StatusOption) {
    // Вместе с ником уходит и стол его человека — спрашиваем заранее, чтобы
    // это не было сюрпризом. Возврат ника стол сам НЕ возвращает.
    const found = option.inactive ? null : desksOf(option);
    if (found) {
      const ok = await confirmDialog({
        title: `«${option.label}» — в неактуальные?`,
        description: `Вместе с ником в неактуальные уйдёт ${found.desks.length === 1 ? "стол" : "столы"} ${found.desks.map((p) => `«${p.name}»`).join(", ")}. Ничего не удаляется — вернуть можно из «Неактуальных».`,
        confirmLabel: "В неактуальные",
      });
      if (!ok) return;
    }
    setBusy(option.value);
    try {
      await setNickOptionInactive({ workspaceId, kind, value: option.value, inactive: !option.inactive });
      if (found) {
        const r = await retireDesks(found);
        if (r.failed > 0) {
          toast.warning(`«${option.label}» — в неактуальных, но стол убрать не удалось`, {
            description: "Уберите его вручную: «Столы» → «⋯» → «В неактуальные».",
          });
          return;
        }
        toast.success(`«${option.label}» и ${r.done === 1 ? "стол" : `столы (${r.done})`} — в неактуальных`);
        return;
      }
      toast.success(option.inactive ? `«${option.label}» снова в работе` : `«${option.label}» — в неактуальных`);
    } catch (error) {
      toast.error("Не удалось изменить ник", { description: firestoreErrorText(error, "База не приняла запись") });
    } finally {
      setBusy(null);
    }
  }

  /** Столы держателя, названные по самому нику, — переименуются вслед за ним. */
  function desksNamedAfter(option: StatusOption): WorkspacePage[] {
    return desksNamedAfterNick(allPages, kind, boundBy.get(option.value), option.label);
  }

  /** Переименовать ник (у Owner — и столы, названные по нему). true — записано. */
  async function rename(option: StatusOption, to: string): Promise<boolean> {
    const ok = await renameNickWithDesks({
      workspaceId,
      kind,
      option,
      to,
      holder: boundBy.get(option.value) ?? null,
      desks: desksNamedAfter(option),
      viewerIsOwner,
    });
    // Список освежаем фоном: ник уже записан, и окно ждать этого не должно.
    if (ok) void Promise.resolve(onChanged()).catch(() => undefined);
    return ok;
  }

  function row(option: StatusOption) {
    const owner = boundBy.get(option.value);
    const wrongRole = owner ? !canHoldNick(kind, owner) : false;
    const locked = owner ? nickLockedFor(owner, meUid, viewerIsOwner, viewerIsCreator) : false;
    return (
      <div
        key={option.value}
        className={cn(
          "flex min-w-0 flex-col gap-2 rounded-lg border border-border/70 px-3 py-2 sm:flex-row sm:items-center",
          option.inactive && "opacity-75"
        )}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: `hsl(${option.color})` }} />
          <span className="min-w-0 truncate text-sm font-medium">{option.label}</span>
          {option.inactive && <span className="shrink-0 text-[11px] text-muted-foreground">неактуальный</span>}
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          {owner ? (
            <span className="inline-flex min-w-0 items-center gap-1.5 text-[12px]">
              <MemberAvatar id={owner.uid} name={owner.name} nickname={owner.nickname} photoURL={owner.photoURL} className="h-5 w-5 shrink-0" />
              <span className="max-w-[10rem] truncate" title={owner.email}>
                {realNameOf(owner)}
              </span>
              {wrongRole && (
                <span className="inline-flex items-center gap-1 text-warning" title="Ник закреплён, а по роли он человеку уже не положен">
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
              disabled={busy === option.value || locked}
              title={locked ? nickLockReason(owner, viewerIsOwner) : undefined}
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
            disabled={busy === option.value || locked}
            title={locked && owner ? nickLockReason(owner, viewerIsOwner) : "Переименовать ник"}
            aria-label={`Переименовать ник «${option.label}»`}
            onClick={() => setRenameOption(option)}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="min-h-11 px-2 text-muted-foreground sm:h-7 sm:min-h-0"
            disabled={busy === option.value}
            title={option.inactive ? "Вернуть в быстрый выбор" : "Убрать из быстрого выбора — ник останется в заказах"}
            aria-label={option.inactive ? "Вернуть в быстрый выбор" : "В неактуальные"}
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
        <CardTitle className="flex flex-wrap items-center gap-2">
          <AtSign className="h-4 w-4" /> {text.title}
          <span className="font-mono text-xs font-normal tabular-nums text-muted-foreground">{activeAll.length}</span>
          {freeCount > 0 && <span className="text-[11px] font-normal text-muted-foreground">· свободных {freeCount}</span>}
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
          <Input value={newNick} onChange={(e) => setNewNick(e.target.value)} maxLength={NICK_MAX_LENGTH} placeholder="Новый ник" className="h-9" />
          <Button type="submit" size="sm" variant="outline" className="min-h-11 shrink-0 gap-1.5 sm:min-h-0" disabled={!newNick.trim() || adding}>
            {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Добавить
          </Button>
        </form>

        <div className="flex flex-col gap-1.5">
          {activeAll.length === 0 && <p className="text-[12px] text-muted-foreground">Ников пока нет — добавьте первый выше.</p>}
          {activeAll.length > 0 && active.length === 0 && <p className="text-[12px] text-muted-foreground">По поиску ников нет.</p>}
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
          {staleCount > 0 && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="min-h-11 gap-1.5 self-start sm:min-h-0"
              disabled={busy !== null}
              onClick={() => void retireStaleDesks()}
            >
              {busy === "__stale__" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Archive className="h-3.5 w-3.5" />}
              Убрать столы неактуальных ников · {staleCount}
            </Button>
          )}
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
          viewerIsCreator={viewerIsCreator}
          onClose={() => setBindOption(null)}
          onSaved={onChanged}
        />
      )}
      {renameOption && (
        <RenameNickDialog
          kind={kind}
          option={renameOption}
          options={options}
          holder={boundBy.get(renameOption.value) ?? null}
          deskName={viewerIsOwner ? (desksNamedAfter(renameOption)[0]?.name ?? null) : null}
          onClose={() => setRenameOption(null)}
          onSubmit={(label) => rename(renameOption, label)}
        />
      )}
    </Card>
  );
}

/**
 * Привязать свободный ник к человеку. Показываются только те, у кого ника
 * этого вида ЕЩЁ НЕТ: так просил Nurba — сменить ник человеку, у которого он
 * уже есть, можно из его строки в разделе (там видно, какой ник уйдёт).
 */
function BindMemberDialog({
  kind,
  workspaceId,
  option,
  members,
  meUid,
  viewerIsOwner,
  viewerIsCreator = false,
  onClose,
  onSaved,
}: {
  kind: NickKind;
  workspaceId: string;
  option: StatusOption;
  members: WorkspaceMember[];
  meUid: string;
  viewerIsOwner: boolean;
  /** Создатель workspace: только он трогает записи других Owner. */
  viewerIsCreator?: boolean;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const text = LIST_TEXT[kind];
  const q = query.trim().toLowerCase();
  const eligible = members.filter((m) => canHoldNick(kind, m));
  const withoutNick = eligible.filter((m) => !memberNickValue(m, kind));
  const people = withoutNick
    .filter((m) => !q || `${realNameOf(m)} ${m.name} ${m.email ?? ""}`.toLowerCase().includes(q))
    .sort((a, b) => realNameOf(a).localeCompare(realNameOf(b), "ru"));

  async function bind(member: WorkspaceMember) {
    setSaving(member.uid);
    try {
      await linkMemberNick({ workspaceId, uid: member.uid, kind, target: { optionValue: option.value }, members });
      const adopted = await adoptScheduleRowByNick({
        workspaceId,
        memberUid: member.uid,
        nickLabel: option.label,
        actorUid: meUid,
        kind,
        role: member.role,
      });
      toast.success(`«${option.label}» привязан`, {
        description: adopted ? `${realNameOf(member)} · график «${adopted}» перенесён на аккаунт` : realNameOf(member),
      });
      onClose();
      await Promise.resolve(onSaved()).catch(() => undefined);
    } catch (error) {
      toast.error("Не удалось привязать ник", { description: firestoreErrorText(error, "База не приняла запись") });
    } finally {
      setSaving(null);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Привязать «{option.label}»</DialogTitle>
          <DialogDescription>{text.bindHint}</DialogDescription>
        </DialogHeader>
        {withoutNick.length > 5 && (
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Найти человека" className="pl-8" />
          </div>
        )}
        <div className="flex max-h-72 flex-col gap-0.5 overflow-y-auto">
          {people.length === 0 && (
            <p className="py-6 text-center text-[12px] text-muted-foreground">
              {eligible.length === 0
                ? `Нет подходящих людей — ${text.nobody}.`
                : withoutNick.length === 0
                  ? "У всех уже есть ник. Чтобы сменить — откройте ник человека в его строке."
                  : "Никого не нашли."}
            </p>
          )}
          {people.map((m) => {
            const locked = nickLockedFor(m, meUid, viewerIsOwner, viewerIsCreator);
            return (
              <button
                key={m.uid}
                type="button"
                disabled={Boolean(saving) || locked}
                onClick={() => void bind(m)}
                className="flex min-h-11 min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent disabled:opacity-50"
              >
                <MemberAvatar id={m.uid} name={m.name} nickname={m.nickname} photoURL={m.photoURL} className="h-7 w-7 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{realNameOf(m)}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {locked ? nickLockReason(m, viewerIsOwner) : m.email}
                  </span>
                </span>
                {saving === m.uid && <Loader2 className="h-4 w-4 animate-spin" />}
              </button>
            );
          })}
        </div>
        {eligible.length > withoutNick.length && withoutNick.length > 0 && (
          <p className="text-[11px] text-muted-foreground">
            Кто уже с ником — не показан ({eligible.length - withoutNick.length}).
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
