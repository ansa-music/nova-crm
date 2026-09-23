import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { ClipboardList, Eye, Moon, Pin, Search, Sun, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { CreatePageDialog } from "@/components/pagesnav/CreatePageDialog";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace } from "@/hooks/useWorkspace";
import { usePermissions } from "@/hooks/usePermissions";
import { usePeopleDesks } from "@/hooks/usePeopleDesks";
import { useUserPageNav } from "@/hooks/useUserPageNav";
import { useAccountMenu, useNavModel } from "@/hooks/useNavModel";
import { PAGE_ICON_MAP } from "@/utils/pageIcons";
import { canOpenDesk } from "@/utils/peopleDesks";
import { displayNameOf } from "@/utils/displayName";
import { cn } from "@/utils/cn";
import { ROLE_LABELS, type WorkspacePage } from "@/types";

type CommandItem = {
  id: string;
  kind: "action" | "go" | "recent" | "page" | "person";
  label: string;
  hint?: string;
  href?: string;
  icon: LucideIcon;
  color?: string;
  run?: () => void;
  /** После выбора палитра остаётся открытой (переход во вложенный список). */
  keepOpen?: boolean;
  /** Зелёная подсветка, как у пункта меню (заказ ждёт). */
  alert?: boolean;
  badge?: number;
};

const GROUP_TITLES: Record<CommandItem["kind"], string> = {
  action: "Действия",
  go: "Разделы",
  recent: "Недавние столы",
  page: "Столы",
  person: "Люди",
};

const GROUP_ORDER: CommandItem["kind"][] = ["action", "go", "recent", "page", "person"];

function matches(q: string, ...fields: Array<string | undefined>) {
  if (!q) return true;
  return fields.some((f) => (f ?? "").toLowerCase().includes(q));
}

/**
 * Палитра Ctrl+K. Разделы — все пункты навигационной модели (с теми же
 * гейтами, что в меню), действия — из общего меню аккаунта, столы ищутся и по
 * имени ответственного. `hideTrigger` оставлен для совместимости: кнопку
 * теперь рисует Sidebar (подсказка ⌘K в широкой панели), а AppLayout держит
 * только сам диалог.
 */
export function GlobalSearch({ hideTrigger = false }: { hideTrigger?: boolean }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  /** Вложенный список «Смотреть как…» — роли вместо всего остального. */
  const [roleMode, setRoleMode] = useState(false);
  const [createPageOpen, setCreatePageOpen] = useState(false);
  const { pages, members } = useWorkspace();
  const permissions = usePermissions();
  const { profile } = useAuth();
  const { selectPerson, peopleGroups } = usePeopleDesks();
  const { recentIds, pinnedIds } = useUserPageNav(profile?.uid);
  const nav = useNavModel();
  const account = useAccountMenu({ openCreatePage: () => setCreatePageOpen(true) });
  const navigate = useNavigate();
  // Owner or Тимлид: may open every desk.
  const isOwner = permissions.hasFullDeskAccess;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const isCtrl = e.ctrlKey || e.metaKey;
      if (!isCtrl || e.code !== "KeyK") return;
      const tag = (document.activeElement?.tagName ?? "").toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      e.preventDefault();
      setOpen(true);
    }
    function onPalette() {
      setOpen(true);
    }
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("nova:command-palette", onPalette);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("nova:command-palette", onPalette);
    };
  }, []);

  const q = query.trim().toLowerCase();

  const isDark =
    account.theme === "dark" ||
    (account.theme === "system" &&
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);

  const actionItems: CommandItem[] = useMemo(() => {
    const list: CommandItem[] = [];
    const createPage = account.actions.find((a) => a.key === "create-page");
    if (createPage) {
      list.push({ id: "act-new-desk", kind: "action", label: "Новый стол", hint: "создать", icon: createPage.icon, run: () => void createPage.run() });
    }
    // «/orders#new» — страница «Заказы» открывает диалог выдачи по хэшу.
    list.push({ id: "act-new-order", kind: "action", label: "Новый заказ", hint: "Заказы", icon: ClipboardList, href: "/orders#new" });
    list.push({
      id: "act-theme",
      kind: "action",
      label: isDark ? "Светлая тема" : "Тёмная тема",
      hint: "тема",
      icon: isDark ? Sun : Moon,
      run: account.toggleTheme,
    });
    list.push({ id: "act-keys", kind: "action", label: "Горячие клавиши", hint: "?", icon: account.shortcuts.icon, run: () => void account.shortcuts.run() });
    if (account.showRoleSwitcher) {
      list.push({
        id: "act-role",
        kind: "action",
        label: "Смотреть как…",
        hint: ROLE_LABELS[account.currentRole],
        icon: Eye,
        keepOpen: true,
        run: () => setRoleMode(true),
      });
    }
    for (const a of account.actions) {
      if (a.key === "create-page" || a.key === "create-workspace") continue;
      list.push({ id: `act-${a.key}`, kind: "action", label: a.label, icon: a.icon, run: () => void a.run() });
    }
    return list;
  }, [account, isDark]);

  const roleItems: CommandItem[] = useMemo(
    () =>
      account.simulatedRoles.map((role) => ({
        id: `role-${role}`,
        kind: "action" as const,
        label: `Смотреть как ${ROLE_LABELS[role]}`,
        hint: role === account.realRole ? "реальная" : role === account.currentRole ? "сейчас" : undefined,
        icon: Eye,
        run: () => void account.setSimulatedRole(role),
      })),
    [account]
  );

  const goItems: CommandItem[] = useMemo(() => {
    const list: CommandItem[] = [];
    for (const section of nav.sections) {
      for (const item of section.items) {
        list.push({
          id: `go-${item.key}`,
          kind: "go",
          label: item.label,
          hint: section.title,
          href: item.to,
          icon: item.icon,
          alert: item.alert,
          badge: item.badge,
        });
      }
    }
    return list;
  }, [nav.sections]);

  function pageOpenable(p: WorkspacePage) {
    return canOpenDesk({
      page: p,
      uid: profile?.uid,
      isOwner,
      deskBlocked: permissions.deskBlocked,
      seesAllDesks: permissions.seesAllDesks,
    });
  }

  function responsibleOf(p: WorkspacePage) {
    return p.responsibleUserId ? members.find((m) => m.uid === p.responsibleUserId) : undefined;
  }

  function pageItem(p: WorkspacePage, kind: "page" | "recent", pinned?: boolean): CommandItem {
    const owner = responsibleOf(p);
    return {
      id: `${kind}-${p.id}`,
      kind,
      label: p.name,
      hint: pinned ? "закреплён" : owner ? displayNameOf(owner) : undefined,
      href: `/page/${p.id}`,
      icon: pinned ? Pin : (PAGE_ICON_MAP[p.icon] ?? PAGE_ICON_MAP.LayoutGrid),
      color: p.color,
    };
  }

  // Недавние — только на пустом запросе: с запросом те же столы найдутся в
  // «Столах», и дубли только мешали бы стрелкам.
  const recentItems: CommandItem[] = useMemo(() => {
    if (q) return [];
    const out: CommandItem[] = [];
    const seen = new Set<string>();
    for (const id of [...pinnedIds, ...recentIds]) {
      if (seen.has(id)) continue;
      const p = pages.find((x) => x.id === id);
      if (!p || !pageOpenable(p)) continue;
      seen.add(id);
      out.push(pageItem(p, "recent", pinnedIds.includes(id)));
      if (out.length >= 6) break;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, pinnedIds, recentIds, pages, members, permissions, profile?.uid, isOwner]);

  // Стол ищется и по имени ответственного: «стол Айдара» набирают именем.
  const pageItems: CommandItem[] = useMemo(
    () =>
      pages
        .filter(pageOpenable)
        .filter((p) => {
          if (!q) return true;
          const owner = responsibleOf(p);
          return matches(q, p.name, owner && displayNameOf(owner), owner?.name, owner?.nickname, owner?.email);
        })
        .map((p) => pageItem(p, "page")),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pages, q, permissions, profile?.uid, isOwner, members]
  );

  const peopleItems: CommandItem[] = useMemo(() => {
    if (!q) return [];
    return members
      .filter((m) => matches(q, m.name, m.email, m.nickname, displayNameOf(m)))
      .map((m) => {
        const group = peopleGroups.find((g) => g.uid === m.uid);
        const openPage = group?.pages.find((page) => pageOpenable(page));
        return {
          id: `person-${m.uid || m.email}`,
          kind: "person" as const,
          label: displayNameOf(m),
          hint: m.email,
          href: openPage ? `/page/${openPage.id}` : "/people",
          icon: Users,
          run: m.uid ? () => selectPerson(m.uid) : undefined,
        };
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members, q, peopleGroups, profile?.uid, isOwner, permissions.role, selectPerson]);

  const items: CommandItem[] = roleMode
    ? roleItems.filter((i) => matches(q, i.label))
    : [
        ...actionItems.filter((i) => matches(q, i.label, i.hint)),
        ...goItems.filter((i) => matches(q, i.label, i.hint)),
        ...recentItems,
        ...pageItems,
        ...peopleItems,
      ];
  const total = items.length;

  useEffect(() => {
    setActiveIndex(0);
  }, [query, open, roleMode]);

  function close() {
    setOpen(false);
    setQuery("");
    setRoleMode(false);
  }

  function goItem(item: CommandItem) {
    if (item.run) item.run();
    if (item.href) navigate(item.href);
    if (item.keepOpen) {
      setQuery("");
      return;
    }
    close();
  }

  const groups = GROUP_ORDER.map((kind) => ({ kind, title: GROUP_TITLES[kind], items: items.filter((i) => i.kind === kind) })).filter(
    (g) => g.items.length > 0
  );

  return (
    <>
      {!hideTrigger && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex h-8 w-full max-w-xl items-center gap-2 rounded-md border border-border bg-background px-3 text-[13px] text-muted-foreground transition-colors duration-200 hover:text-foreground"
        >
          <Search className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1 truncate text-left">Перейти…</span>
          <kbd className="hidden rounded-sm border border-border px-1.5 py-0.5 font-mono text-[10px] tracking-wide sm:inline">
            Ctrl K
          </kbd>
        </button>
      )}

      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (v) setOpen(true);
          else close();
        }}
      >
        {/* На телефоне — во весь экран: клавиатура съедает половину высоты, и
            центрированное окно с 22rem списка не оставляло места результатам. */}
        <DialogContent
          className={cn(
            "top-[18%] flex max-w-xl translate-y-0 flex-col gap-0 overflow-hidden rounded-md p-0",
            "max-sm:left-0 max-sm:top-0 max-sm:h-[100dvh] max-sm:max-h-none max-sm:w-screen max-sm:max-w-none max-sm:translate-x-0 max-sm:rounded-none"
          )}
        >
          <DialogTitle className="sr-only">Командный центр</DialogTitle>
          <div className="shrink-0 border-b border-border px-3 py-3 max-sm:pr-14">
            <div className="flex items-center gap-2">
              {roleMode ? (
                <button
                  type="button"
                  onClick={() => setRoleMode(false)}
                  className="rounded-sm px-1 font-mono text-[10px] text-muted-foreground hover:text-foreground"
                >
                  ← назад
                </button>
              ) : (
                <Search className="h-4 w-4 text-muted-foreground" />
              )}
              <Input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={roleMode ? "Роль…" : "Стол, человек, раздел, действие…"}
                className="h-10 border-0 bg-transparent px-1 text-[15px] shadow-none focus-visible:ring-0"
                onKeyDown={(e) => {
                  if (e.code === "ArrowDown") {
                    e.preventDefault();
                    setActiveIndex((i) => (total === 0 ? 0 : (i + 1) % total));
                  } else if (e.code === "ArrowUp") {
                    e.preventDefault();
                    setActiveIndex((i) => (total === 0 ? 0 : (i - 1 + total) % total));
                  } else if (e.code === "Enter" && items[activeIndex]) {
                    e.preventDefault();
                    goItem(items[activeIndex]);
                  } else if (e.code === "Backspace" && roleMode && !query) {
                    setRoleMode(false);
                  }
                }}
              />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2 scrollbar-thin sm:max-h-[22rem]">
            {groups.map((group) => (
              <div key={group.kind} className="mb-1">
                <p className="eyebrow px-2 py-1.5">{group.title}</p>
                {group.items.map((item) => {
                  const i = items.indexOf(item);
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => goItem(item)}
                      className={cn(
                        "command-item min-h-11 sm:min-h-0",
                        i === activeIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
                        item.alert && "text-success"
                      )}
                    >
                      <Icon
                        className={cn("h-3.5 w-3.5 shrink-0", !item.color && !item.alert && "text-muted-foreground")}
                        style={{ color: item.color ? `hsl(${item.color})` : undefined }}
                      />
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.badge ? (
                        <span className="rounded-full bg-primary px-1.5 py-0.5 font-mono text-[10px] font-semibold leading-none text-primary-foreground">
                          {item.badge > 9 ? "9+" : item.badge}
                        </span>
                      ) : null}
                      {item.hint && <span className="truncate font-mono text-[10px] text-muted-foreground">{item.hint}</span>}
                    </button>
                  );
                })}
              </div>
            ))}
            {query && items.length === 0 && (
              <p className="px-2 py-10 text-center text-sm text-muted-foreground">Ничего не найдено</p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-3 border-t border-border px-3 py-2 font-mono text-[10px] text-muted-foreground max-sm:pb-[max(0.5rem,env(safe-area-inset-bottom))]">
            <span>↑↓ двигать</span>
            <span>Enter открыть</span>
            <span>Esc закрыть</span>
          </div>
        </DialogContent>
      </Dialog>

      <CreatePageDialog open={createPageOpen} onOpenChange={setCreatePageOpen} />
    </>
  );
}
