import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, UserPlus } from "lucide-react";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/sonner";
import { RoleSelect } from "@/components/members/RoleSelect";
import {
  adoptScheduleRowByNick,
  NickPicker,
  nickChoiceToTarget,
  suggestNickChoice,
  type NickChoice,
} from "@/components/members/NickDialog";
import { approveJoinRequest, DEFAULT_JOIN_ROLE, nickKindForRole } from "@/services/joinRequestService";
import { memberNickValue, NICK_KIND_META, nickOptionsOf, type NickKind } from "@/services/memberService";
import { realNameOf } from "@/utils/displayName";
import { firestoreErrorText } from "@/utils/dbError";
import { refreshWorkspaceMembers } from "@/hooks/useWorkspace";
import { ROLE_LABELS, type JoinRequest, type Role, type Workspace, type WorkspaceMember } from "@/types";

/**
 * Одобрить заявку на вход. Человек пришёл без роли и сам написал, кем
 * работает и под каким ником; здесь это можно оставить как есть или
 * поменять — и роль, и ник — и уже потом впустить. Участник, ник и статус
 * заявки пишутся одной транзакцией (`approveJoinRequest`).
 */
export function ApproveJoinDialog({
  workspaceId,
  workspace,
  request,
  members,
  approverUid,
  onClose,
  onApproved,
}: {
  workspaceId: string;
  workspace: Workspace | null | undefined;
  request: JoinRequest;
  members: WorkspaceMember[];
  approverUid: string;
  onClose: () => void;
  onApproved: () => Promise<void> | void;
}) {
  const requestedRole: Role = request.requestedRole ?? DEFAULT_JOIN_ROLE;
  const [role, setRole] = useState<Role>(requestedRole);
  const kind = nickKindForRole(role);
  const options = useMemo(() => (kind ? nickOptionsOf(workspace, kind) : []), [workspace, kind]);
  // Выбор ника живёт по роли: сменили Технаря на ОС — предлагаем тот же ник,
  // но уже из списка ников ОС (а не тащим вариант из чужого списка).
  const [choices, setChoices] = useState<Partial<Record<NickKind, NickChoice | null>>>({});
  const suggested = kind ? suggestNickChoice(request.requestedNick, options, kind, members, request.uid) : null;
  // Ник, который человек попросил, уже у другого — занятые ники в выборе
  // скрыты, поэтому говорим об этом прямо, иначе просьба просто пропала бы.
  const requestedLabel = request.requestedNick?.trim().toLowerCase() ?? "";
  const requestedOption = kind && requestedLabel ? options.find((o) => o.label.trim().toLowerCase() === requestedLabel) : undefined;
  const requestedTakenBy =
    kind && requestedOption
      ? members.find((m) => m.uid !== request.uid && memberNickValue(m, kind) === requestedOption.value)
      : undefined;
  const choice = kind ? (kind in choices ? choices[kind] ?? null : suggested) : null;
  const [saving, setSaving] = useState(false);

  // Список участников в браузере не живой — освежаем, чтобы «занят» в
  // выборе ника был правдой. Окончательно занятость проверяет сервер.
  useEffect(() => {
    void refreshWorkspaceMembers(workspaceId).catch(() => undefined);
  }, [workspaceId]);

  async function approve() {
    setSaving(true);
    try {
      const { nickLabel } = await approveJoinRequest({
        workspaceId,
        request,
        role,
        nick: kind && choice ? nickChoiceToTarget(choice) : null,
        approvedBy: approverUid,
        members,
      });
      const adopted = nickLabel
        ? await adoptScheduleRowByNick({ workspaceId, memberUid: request.uid, nickLabel, actorUid: approverUid, kind: kind!, role })
        : null;
      toast.success(`${request.name} в workspace как ${ROLE_LABELS[role]}`, {
        description: nickLabel
          ? `Ник: ${nickLabel}${adopted ? ` · график «${adopted}» перенесён на аккаунт` : ""}`
          : undefined,
      });
      onClose();
      // Одобрение уже записано — сбой обновления списка его не отменяет.
      await Promise.resolve(onApproved()).catch(() => undefined);
    } catch (error) {
      toast.error("Не удалось одобрить заявку", { description: firestoreErrorText(error, "База не приняла запись") });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-4 w-4 shrink-0 text-primary" />
            Впустить в workspace
          </DialogTitle>
          <DialogDescription>
            Проверьте роль и ник — можно оставить, как человек попросил, или поменять.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-w-0 items-center gap-3 rounded-lg border border-border/70 p-3">
          <MemberAvatar id={request.uid} name={request.name} photoURL={request.photoURL} className="h-9 w-9 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{request.name}</p>
            <p className="truncate text-xs text-muted-foreground">{request.email}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Просит: <span className="text-foreground">{request.requestedRole ? ROLE_LABELS[request.requestedRole] : "роль не выбрал"}</span>
              {request.requestedNick ? (
                <>
                  {" "}· ник <span className="font-medium text-foreground">«{request.requestedNick}»</span>
                </>
              ) : null}
            </p>
          </div>
        </div>

        <label className="flex items-center justify-between gap-3 text-[13px]">
          Роль
          <RoleSelect value={role} onChange={setRole} className="w-40" />
        </label>

        {kind ? (
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2 text-[13px]">
              <span>{NICK_KIND_META[kind].title}</span>
              {choice && (
                <button
                  type="button"
                  onClick={() => setChoices((prev) => ({ ...prev, [kind]: null }))}
                  className="min-h-11 text-[11px] text-muted-foreground underline underline-offset-2 sm:min-h-0"
                >
                  без ника
                </button>
              )}
            </div>
            <NickPicker
              key={kind}
              kind={kind}
              options={options}
              members={members}
              selfUid={request.uid}
              currentValue={null}
              choice={choice}
              onChoice={(next) => setChoices((prev) => ({ ...prev, [kind]: next }))}
              initialQuery={choice?.kind === "new" ? choice.label : ""}
            />
            {requestedTakenBy && requestedOption && (
              <p className="text-[11px] text-warning">
                Ник «{requestedOption.label}», который просил человек, уже закреплён за {realNameOf(requestedTakenBy)}.
              </p>
            )}
            {!choice && (
              <p className="text-[11px] text-muted-foreground">
                Без ника — его можно закрепить позже на странице «Команда».
              </p>
            )}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">Для роли «{ROLE_LABELS[role]}» ник не нужен.</p>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Отмена
          </Button>
          <Button className="gap-1.5" onClick={() => void approve()} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Впустить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
