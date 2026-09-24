import { useCallback, useEffect, useMemo, useState } from "react";
import { Crown, Eye, EyeOff, KeyRound, Loader2 } from "lucide-react";
import { RoleSelect } from "@/components/members/RoleSelect";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { useAuth } from "@/hooks/useAuth";
import { refreshWorkspaceMembers, useWorkspace } from "@/hooks/useWorkspace";
import {
  OWNER_ACCESS_KEY_MAX,
  OWNER_ACCESS_KEY_MIN,
  fetchOwnerAccessKey,
  normalizeOwnerAccessKey,
  revokeOwnerRole,
  setOwnerAccessKey,
  type OwnerAccessKeyInfo,
} from "@/services/ownerAccessService";
import { ROLE_LABELS, type OwnerAccessRequest, type Role } from "@/types";
import { confirmDialog } from "@/utils/appDialog";
import { timeAgo } from "@/utils/date";
import { firestoreErrorText } from "@/utils/dbError";
import { displayNameOf, myDisplayName } from "@/utils/displayName";

const GRANTABLE_ROLES: Role[] = ["owner", "teamlead", "admin", "manager", "os", "viewer"];
const DEMOTE_ROLES: Role[] = ["teamlead", "admin", "manager", "os", "viewer"];

type Resolve = (
  request: OwnerAccessRequest,
  status: "approved" | "denied",
  actorUid: string,
  actorName: string,
  grant?: { role: Role; currentExtraRoles?: Role[] }
) => Promise<void>;

/**
 * «Настройки → Ключ доступа» у Owner: заявки по ключу (роль выбирается при
 * выдаче — не обязательно Owner), кто сейчас Owner (права снимаются ТИХО, без
 * уведомления человеку) и смена самого ключа.
 */
export function OwnerAccessPanel({
  requests,
  resolve,
}: {
  requests: OwnerAccessRequest[];
  resolve: Resolve;
}) {
  const { profile } = useAuth();
  const { activeWorkspace, members } = useWorkspace();
  const workspaceId = activeWorkspace?.id ?? null;
  const [grantRole, setGrantRole] = useState<Record<string, Role>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const memberOf = useCallback((uid: string) => members.find((m) => m.uid === uid) ?? null, [members]);
  const meName = myDisplayName(profile, members);

  async function handleResolve(request: OwnerAccessRequest, status: "approved" | "denied") {
    if (!workspaceId || !profile) return;
    const role = grantRole[request.id] ?? "owner";
    const member = memberOf(request.fromUid);
    const name = member ? displayNameOf(member) : request.fromName || request.fromEmail;
    if (status === "approved") {
      const ok = await confirmDialog({
        title:
          role === "owner" ? `Выдать права Owner: ${name}?` : `Выдать роль «${ROLE_LABELS[role]}»: ${name}?`,
        description:
          role === "owner"
            ? "Полный доступ Owner: все столы, участники, роли, настройки и история. Забрать можно здесь же, в списке «Owner сейчас»."
            : `Человек получит роль «${ROLE_LABELS[role]}» вместо нынешней.`,
      });
      if (!ok) return;
    }
    setBusy(`req:${request.id}`);
    try {
      await resolve(request, status, profile.uid, meName, {
        role,
        currentExtraRoles: member?.extraRoles,
      });
      if (status === "approved") await refreshWorkspaceMembers(workspaceId);
      toast.success(
        status === "approved"
          ? role === "owner"
            ? `${name} — теперь Owner`
            : `${name} — теперь «${ROLE_LABELS[role]}»`
          : "Запрос отклонён"
      );
    } catch (error) {
      toast.error(firestoreErrorText(error, error instanceof Error ? error.message : "Не удалось обработать заявку"));
    } finally {
      setBusy(null);
    }
  }

  const owners = useMemo(
    () =>
      members
        .filter((m) => m.uid && m.status === "active" && m.role === "owner")
        .sort((a, b) => displayNameOf(a).localeCompare(displayNameOf(b), "ru")),
    [members]
  );

  async function handleRevoke(uid: string, role: Role) {
    if (!workspaceId || !profile || role === "owner") return;
    const member = memberOf(uid);
    if (!member) return;
    const name = displayNameOf(member);
    const ok = await confirmDialog({
      title: `Забрать права Owner у ${name}?`,
      description: `Роль станет «${ROLE_LABELS[role]}». Уведомление ему не придёт.`,
      confirmLabel: "Забрать",
      destructive: true,
    });
    if (!ok) return;
    setBusy(`own:${uid}`);
    try {
      await revokeOwnerRole({
        workspaceId,
        uid,
        role,
        currentExtraRoles: member.extraRoles,
        workspaceOwnerId: activeWorkspace?.ownerId ?? null,
        actorUid: profile.uid,
      });
      await refreshWorkspaceMembers(workspaceId);
      toast.success(`${name} — теперь «${ROLE_LABELS[role]}»`, { description: "Без уведомления" });
    } catch (error) {
      toast.error(firestoreErrorText(error, error instanceof Error ? error.message : "Не удалось сменить роль"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h3 className="eyebrow">Заявки по ключу</h3>
        {requests.length === 0 ? (
          <p className="text-sm text-muted-foreground">Заявок нет.</p>
        ) : (
          requests.map((request) => {
            const member = memberOf(request.fromUid);
            const name = member ? displayNameOf(member) : request.fromName || request.fromEmail || request.fromUid;
            const pending = request.status === "pending";
            return (
              <div key={request.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{name}</p>
                  <p className="text-xs text-muted-foreground">
                    {pending
                      ? `${member ? `сейчас «${ROLE_LABELS[member.role] ?? member.role}» · ` : ""}${timeAgo(request.createdAt)}`
                      : request.status === "approved"
                        ? `Выдано: «${ROLE_LABELS[request.grantedRole ?? "owner"] ?? "Owner"}» · ${timeAgo(request.updatedAt)}`
                        : `Отклонено · ${timeAgo(request.updatedAt)}`}
                  </p>
                </div>
                {pending && (
                  <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                    <RoleSelect
                      className="w-full sm:w-36"
                      value={grantRole[request.id] ?? "owner"}
                      assignableRoles={GRANTABLE_ROLES}
                      disabled={Boolean(busy)}
                      onChange={(role) => setGrantRole((prev) => ({ ...prev, [request.id]: role }))}
                    />
                    <Button
                      size="sm"
                      className="min-h-11 flex-1 sm:min-h-8 sm:flex-none"
                      disabled={Boolean(busy)}
                      onClick={() => void handleResolve(request, "approved")}
                    >
                      {busy === `req:${request.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      Выдать
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="min-h-11 flex-1 sm:min-h-8 sm:flex-none"
                      disabled={Boolean(busy)}
                      onClick={() => void handleResolve(request, "denied")}
                    >
                      Отклонить
                    </Button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="eyebrow">Owner сейчас</h3>
        <p className="text-xs text-muted-foreground">
          Смените роль, чтобы забрать права Owner. Человеку уведомление не придёт.
        </p>
        {owners.map((member) => {
          const main = member.uid === activeWorkspace?.ownerId;
          const self = member.uid === profile?.uid;
          return (
            <div key={member.uid} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3">
              <Crown className="h-4 w-4 shrink-0 text-warning" />
              <p className="min-w-0 flex-1 truncate text-sm font-medium">{displayNameOf(member)}</p>
              {main ? <Badge variant="outline">главный</Badge> : null}
              {self ? <Badge variant="outline">вы</Badge> : null}
              {main || self ? null : busy === `own:${member.uid}` ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : (
                <RoleSelect
                  className="w-full sm:w-36"
                  value="owner"
                  assignableRoles={DEMOTE_ROLES}
                  disabled={Boolean(busy)}
                  onChange={(role) => void handleRevoke(member.uid, role)}
                />
              )}
            </div>
          );
        })}
      </section>

      {workspaceId && profile ? (
        <AccessKeyEditor workspaceId={workspaceId} actorUid={profile.uid} actorName={meName} />
      ) : null}
    </div>
  );
}

function AccessKeyEditor({
  workspaceId,
  actorUid,
  actorName,
}: {
  workspaceId: string;
  actorUid: string;
  actorName: string;
}) {
  const [info, setInfo] = useState<OwnerAccessKeyInfo | null>(null);
  const [failed, setFailed] = useState(false);
  const [shown, setShown] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setInfo(null);
    setFailed(false);
    let cancelled = false;
    fetchOwnerAccessKey(workspaceId)
      .then((row) => {
        if (!cancelled) setInfo(row);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const next = normalizeOwnerAccessKey(draft);
  const invalid = next.length < OWNER_ACCESS_KEY_MIN || next.length > OWNER_ACCESS_KEY_MAX;

  async function save() {
    if (invalid || saving) return;
    setSaving(true);
    try {
      await setOwnerAccessKey({ workspaceId, key: next, actorUid, actorName });
      setInfo({ key: next, custom: true, updatedAt: Date.now(), updatedByName: actorName });
      setDraft("");
      setShown(true);
      toast.success("Ключ изменён", { description: "Старый ключ больше не подходит" });
    } catch (error) {
      toast.error(firestoreErrorText(error, error instanceof Error ? error.message : "Не удалось сменить ключ"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="flex flex-col gap-2">
      <h3 className="eyebrow flex items-center gap-1.5">
        <KeyRound className="h-3.5 w-3.5" /> Ключ
      </h3>
      {failed ? (
        <p className="text-sm text-destructive">Не удалось прочитать текущий ключ.</p>
      ) : !info ? (
        <p className="text-sm text-muted-foreground">Загрузка…</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Сейчас:</span>
          <code className="rounded-md bg-muted px-2 py-0.5 font-mono">{shown ? info.key : "•".repeat(Math.max(4, info.key.length))}</code>
          <Button
            variant="ghost"
            size="icon"
            data-compact
            className="h-8 w-8"
            title={shown ? "Скрыть" : "Показать"}
            aria-label={shown ? "Скрыть ключ" : "Показать ключ"}
            onClick={() => setShown((v) => !v)}
          >
            {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
          <span className="text-xs text-muted-foreground">
            {info.custom
              ? `изменён ${info.updatedAt ? timeAgo(info.updatedAt) : ""}${info.updatedByName ? ` · ${info.updatedByName}` : ""}`
              : "по умолчанию (он виден в исходниках — лучше сменить)"}
          </span>
        </div>
      )}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={draft}
          autoComplete="off"
          maxLength={OWNER_ACCESS_KEY_MAX + 8}
          placeholder={`Новый ключ, от ${OWNER_ACCESS_KEY_MIN} символов`}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save();
          }}
        />
        <Button className="min-h-11 sm:min-h-10" disabled={invalid || saving || failed} onClick={() => void save()}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Сменить ключ
        </Button>
      </div>
    </section>
  );
}
