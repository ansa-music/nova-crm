import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Contact, Lock, Search, Users } from "lucide-react";
import { AccessDenied } from "@/components/common/AccessDenied";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { PageHeader, pageChipClass } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MemberNickChip } from "@/components/members/MemberNickChip";
import { NickDialog } from "@/components/members/NickDialog";
import { NickListCard } from "@/components/members/NickListCard";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { useMembersRefresh } from "@/hooks/useMembersRefresh";
import { useUrlState } from "@/hooks/useUrlState";
import { refreshWorkspaceMembers, useWorkspace } from "@/hooks/useWorkspace";
import { nickLabelOf, nickOptionsOf, type NickKind } from "@/services/memberService";
import { cn } from "@/utils/cn";
import { realNameOf } from "@/utils/displayName";
import { getPresenceStatus, PRESENCE_DOT_COLOR, PRESENCE_LABEL } from "@/utils/presence";
import {
  canHoldNick,
  GROUP_NICK_KIND,
  missingNickKinds,
  nickKindsShownFor,
  nickLockedFor,
  nickLockReason,
  TEAM_GROUP_LABEL,
  TEAM_GROUPS,
  teamGroupOf,
  type TeamGroup,
} from "@/utils/teamGroup";
import { rolesLabel, type WorkspaceMember } from "@/types";

const GROUP_TEXT: Record<TeamGroup, { description: string; empty: string }> = {
  tech: {
    description:
      "Технари и Тимлиды с ролью Технаря (Owner и Admin — в «Других»). Ник технаря — подпись человека везде: «Технари», «Заказы», «График», столы.",
    empty: "Технарей пока нет — роль даётся на «Пользователях» или при одобрении заявки.",
  },
  os: {
    description:
      "ОС и Тимлиды с ролью ОС (Admin с ролью ОС — в «Других», его ник ОС — в его строке там). Ник ОС — вариант «Ответственного» в заказах: по нему ОС видит свои заказы и ставит оценки.",
    empty: "ОС пока нет — роль даётся на «Пользователях» или при одобрении заявки.",
  },
  other: {
    description:
      "Owner и Admin (даже со второй ролью), Тимлиды без второй роли и Viewer. Ник — как подписывать человека в «Заказах», «Графике» и на столах; у кого есть роль ОС, тому нужен ещё и ник ОС.",
    empty: "В разделе пока никого.",
  },
};

/**
 * «Команда» — отдельная страница управления людьми по разделам: Технари, ОС
 * и Другие (Owner, Admin, Тимлид без второй роли, Viewer). В каждом разделе
 * — люди с их никами и свой список ников. Раньше это была вкладка «Ники» на
 * «Пользователях»; Nurba попросил отдельную страницу и раздел «Другие».
 * Открывают Owner и Тимлид (`canManageUsers`), правила держат то же самое.
 */
export default function TeamPage() {
  const { profile } = useAuth();
  const { activeWorkspaceId, activeWorkspace, members } = useWorkspace();
  const permissions = usePermissions();
  // Раздел — в адресе (`?g=os`): F5 и ссылка коллеге открывают тот же.
  const [group, setGroup] = useUrlState<TeamGroup>("g", "tech", { values: TEAM_GROUPS });
  const [query, setQuery] = useState("");
  const [nickDialog, setNickDialog] = useState<{ member: WorkspaceMember; kind: NickKind } | null>(null);

  // Список участников в браузере не живой: освежаем при входе и при возврате
  // на вкладку (не чаще раза в 5 минут — квота Spark). Занятость ника при
  // записи всё равно проверяет сервер (`assertNickFree`).
  useMembersRefresh(activeWorkspaceId, permissions.canManageUsers);

  const people = useMemo(
    () => (Array.isArray(members) ? members : []).filter((m) => m.status === "active" && Boolean(m.uid)),
    [members]
  );
  const byGroup = useMemo(() => {
    const map: Record<TeamGroup, WorkspaceMember[]> = { tech: [], os: [], other: [] };
    for (const m of people) map[teamGroupOf(m)].push(m);
    for (const g of TEAM_GROUPS) map[g].sort((a, b) => realNameOf(a).localeCompare(realNameOf(b), "ru"));
    return map;
  }, [people]);

  if (!permissions.isResolved) return null;
  if (!permissions.canManageUsers) {
    return <AccessDenied reason="Команду ведут Owner и Тимлид." backTo={{ to: "/people", label: "Люди" }} />;
  }
  if (!activeWorkspaceId) return null;

  const meUid = profile?.uid ?? "";
  const viewerIsOwner = permissions.isWorkspaceOwner || permissions.realRole === "owner";
  const allMembers = Array.isArray(members) ? members : [];
  const kind = GROUP_NICK_KIND[group];
  const q = query.trim().toLowerCase();
  // «Без ника» — не хватает хотя бы одного положенного ника (у Admin + ОС это
  // может быть ник ОС: он стоит в «Других», но ник ОС ему нужен для заказов).
  const withoutNickCount = (g: TeamGroup) => byGroup[g].filter((m) => missingNickKinds(m).length > 0).length;
  const rows = byGroup[group].filter((m) => {
    if (!q) return true;
    const nicks = nickKindsShownFor(m)
      .map((k) => nickLabelOf(m, k, nickOptionsOf(activeWorkspace, k)) ?? "")
      .join(" ");
    return `${realNameOf(m)} ${m.name} ${m.email ?? ""} ${nicks}`.toLowerCase().includes(q);
  });
  const missing = withoutNickCount(group);

  return (
    <div className="mx-auto w-full min-w-0 max-w-4xl p-4 sm:p-8">
      <PageHeader
        eyebrow="Workspace"
        title="Команда"
        description="Технари, ОС и все остальные — кто в каком разделе и под каким ником работает. Роли и доступы к столам — на «Пользователях»."
        actions={
          <Button asChild variant="outline" className="min-h-11 gap-1.5 sm:min-h-0">
            <Link to="/users">
              <Users className="h-4 w-4" /> Пользователи
            </Link>
          </Button>
        }
        filters={
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Разделы команды">
            {TEAM_GROUPS.map((g) => {
              const lacking = withoutNickCount(g);
              return (
                <button
                  key={g}
                  type="button"
                  role="tab"
                  aria-selected={group === g}
                  onClick={() => setGroup(g)}
                  className={pageChipClass(group === g)}
                >
                  {TEAM_GROUP_LABEL[g]}
                  <span className="font-mono tabular-nums opacity-80">{byGroup[g].length}</span>
                  {lacking > 0 && (
                    <span className="text-warning" title="Без ника">
                      · {lacking} без ника
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        }
      />

      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Имя, ник или email" className="pl-9" />
      </div>

      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              <Contact className="h-4 w-4" /> {TEAM_GROUP_LABEL[group]}
              <span className="font-mono text-xs font-normal tabular-nums text-muted-foreground">{byGroup[group].length}</span>
              {missing > 0 && <span className="text-[11px] font-normal text-warning">· без ника {missing}</span>}
            </CardTitle>
            <CardDescription>{GROUP_TEXT[group].description}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-1.5">
            {byGroup[group].length === 0 && <p className="text-[12px] text-muted-foreground">{GROUP_TEXT[group].empty}</p>}
            {byGroup[group].length > 0 && rows.length === 0 && <p className="text-[12px] text-muted-foreground">Никого не нашли.</p>}
            {rows.map((m) => {
              const locked = nickLockedFor(m, meUid, viewerIsOwner);
              const presence = getPresenceStatus(m.lastActiveAt);
              return (
                <div key={m.uid} className="flex min-w-0 flex-col gap-2 rounded-lg border border-border/70 px-3 py-2 sm:flex-row sm:items-center sm:gap-3">
                  <div className="flex min-w-0 flex-1 items-center gap-2.5">
                    <span className="relative shrink-0">
                      <MemberAvatar id={m.uid} name={m.name} nickname={m.nickname} photoURL={m.photoURL} className="h-8 w-8" />
                      <span
                        className={cn("absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-card", PRESENCE_DOT_COLOR[presence])}
                        title={PRESENCE_LABEL[presence]}
                      />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {realNameOf(m)}
                        {m.uid === meUid && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(вы)</span>}
                      </span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {rolesLabel(m)}
                        {m.email ? ` · ${m.email}` : ""}
                      </span>
                      {locked && (
                        <span className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                          <Lock className="h-3 w-3 shrink-0" />
                          {nickLockReason(m)}
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5 sm:max-w-[55%] sm:justify-end">
                    {nickKindsShownFor(m).map((k) => (
                      <MemberNickChip
                        key={k}
                        member={m}
                        kind={k}
                        options={nickOptionsOf(activeWorkspace, k)}
                        eligible={canHoldNick(k, m)}
                        locked={locked}
                        lockReason={nickLockReason(m)}
                        onClick={() => setNickDialog({ member: m, kind: k })}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <NickListCard
          key={kind}
          kind={kind}
          workspaceId={activeWorkspaceId}
          options={nickOptionsOf(activeWorkspace, kind)}
          members={allMembers}
          meUid={meUid}
          viewerIsOwner={viewerIsOwner}
          query={query}
          onChanged={() => refreshWorkspaceMembers(activeWorkspaceId)}
        />
      </div>

      {nickDialog && (
        <NickDialog
          workspaceId={activeWorkspaceId}
          kind={nickDialog.kind}
          member={nickDialog.member}
          members={allMembers}
          options={nickOptionsOf(activeWorkspace, nickDialog.kind)}
          onClose={() => setNickDialog(null)}
          onSaved={() => refreshWorkspaceMembers(activeWorkspaceId)}
        />
      )}
    </div>
  );
}
