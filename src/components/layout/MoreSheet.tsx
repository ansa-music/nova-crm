import { NavLink, useLocation } from "react-router";
import { Building2, Check, ChevronDown, Search } from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { RoleSwitcher } from "@/components/common/RoleSwitcher";
import { useAuth } from "@/hooks/useAuth";
import { bottomBarSlot, useAccountMenu, useNavModel } from "@/hooks/useNavModel";
import { DESKS_ITEM_KEY, pathMatches, type NavItem } from "@/config/nav";
import { cn } from "@/utils/cn";

/** Кнопки нижней панели — в листе не повторяются. */
const BOTTOM_BAR_KEYS = new Set(["home", "orders"]);

function Tile({ item, pathname, onNavigate }: { item: NavItem; pathname: string; onNavigate: () => void }) {
  const Icon = item.icon;
  const active = item.forceActive ?? pathMatches(pathname, item.to, item.end);
  return (
    <NavLink
      to={item.to}
      onClick={() => {
        item.onNavigate?.();
        onNavigate();
      }}
      className={cn(
        "relative flex min-h-[72px] flex-col items-center justify-center gap-1.5 rounded-lg border px-2 py-3 text-center text-[12px] font-medium leading-tight transition-colors duration-200",
        active
          ? "nav-link-active border-transparent"
          : item.alert
            ? "border-success/30 bg-success/10 text-success"
            : "border-border bg-card text-foreground hover:bg-foreground/5"
      )}
    >
      <Icon className="h-5 w-5" />
      <span className="line-clamp-2">{item.label}</span>
      {item.badge ? (
        <span className="absolute right-1.5 top-1.5 rounded-full bg-primary px-1.5 py-0.5 font-mono text-[10px] font-semibold leading-none text-primary-foreground">
          {item.badge > 9 ? "9+" : item.badge}
        </span>
      ) : item.alert ? (
        <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-success motion-safe:animate-pulse" />
      ) : null}
    </NavLink>
  );
}

/**
 * Лист «Ещё» на телефоне: плитки разделов по секциям модели, ряд аккаунта и
 * те же пункты, что в выпадашке аккаунта Sidebar — одним источником
 * (`useAccountMenu`), чтобы два меню не разъезжались. Диалоги «Новый стол» и
 * «Создать workspace» держит AppLayout: лист лишь просит их открыть — иначе
 * они закрывались бы вместе с листом.
 */
export function MoreSheet({
  open,
  onOpenChange,
  onCreatePage,
  onCreateWorkspace,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreatePage: () => void;
  onCreateWorkspace: () => void;
}) {
  const { pathname } = useLocation();
  const { profile } = useAuth();
  const close = () => onOpenChange(false);
  const nav = useNavModel({ onNavigate: close });
  const account = useAccountMenu({
    openCreatePage: () => {
      close();
      onCreatePage();
    },
    openCreateWorkspace: () => {
      close();
      onCreateWorkspace();
    },
  });
  // Вторая кнопка нижней панели («Стол ОС», «Дашборд») в листе лишняя. Кроме
  // «Столов»: плитка — вход в секцию, рядом с «Столами ОС» и прочими.
  const hiddenKeys = new Set(BOTTOM_BAR_KEYS);
  const slot = bottomBarSlot(nav);
  if (slot.key !== DESKS_ITEM_KEY) hiddenKeys.add(slot.key);
  const sections = nav.sections
    .map((s) => ({ ...s, items: s.items.filter((i) => !hiddenKeys.has(i.key)) }))
    .filter((s) => s.items.length > 0);
  const activeWs = account.workspaces.find((w) => w.active);

  function runAndClose(run: () => void | Promise<void>) {
    close();
    void run();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/* Ручку примитива гасим: у листа p-0 и прокрутка, а своя ручка липкая
          — остаётся на месте, пока плитки уезжают вверх. */}
      <SheetContent
        side="bottom"
        hideHandle
        aria-describedby={undefined}
        className="max-h-[88dvh] p-0 pb-[env(safe-area-inset-bottom)] scrollbar-thin"
      >
        <SheetTitle className="sr-only">Ещё</SheetTitle>
        {/* Ручка: лист тянут вниз пальцем, и без неё он читается как страница. */}
        <div className="sticky top-0 z-10 bg-background pt-2" aria-hidden>
          <div className="mx-auto h-1 w-9 rounded-sm bg-foreground/20" />
        </div>

        <div className="flex flex-col gap-5 px-4 pb-4 pt-3">
          {/* Справа место под крестик листа (absolute right-2 top-2, 44px). */}
          <button
            type="button"
            onClick={() => {
              close();
              window.dispatchEvent(new Event("nova:command-palette"));
            }}
            className="mr-12 flex min-h-11 items-center gap-2 rounded-lg border border-border bg-card px-3 text-[13px] text-muted-foreground"
          >
            <Search className="h-4 w-4 shrink-0" />
            <span className="flex-1 truncate text-left">Поиск и переход…</span>
          </button>

          {sections.map((section) => (
            <section key={section.key} className="flex flex-col gap-2">
              {section.title && <p className="eyebrow px-0.5">{section.title}</p>}
              <div className="grid grid-cols-3 gap-2">
                {section.items.map((item) => (
                  <Tile key={item.key} item={item} pathname={pathname} onNavigate={close} />
                ))}
              </div>
            </section>
          ))}

          <section className="flex flex-col gap-2 border-t border-border pt-4">
            <p className="eyebrow px-0.5">Аккаунт</p>
            <div className="flex min-h-11 items-center gap-3 px-0.5">
              {profile && (
                <MemberAvatar
                  id={profile.uid}
                  name={profile.name}
                  nickname={profile.nickname}
                  photoURL={profile.photoURL}
                  className="h-10 w-10 shrink-0"
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-medium text-foreground">{account.name}</p>
                <p className="truncate text-[12px] text-muted-foreground">{account.caption}</p>
              </div>
              {(account.workspaces.length > 1 || account.canCreateWorkspace) && (
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="flex min-h-11 max-w-[45%] items-center gap-1.5 rounded-lg border border-border px-2.5 text-[12px] text-foreground"
                    >
                      <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">{activeWs?.name ?? "Workspace"}</span>
                      <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="z-[330] w-56">
                    {account.workspaces.map((ws) => (
                      <DropdownMenuItem key={ws.id} onClick={ws.select}>
                        {ws.name}
                        {ws.active && <Check className="ml-auto h-3.5 w-3.5" />}
                      </DropdownMenuItem>
                    ))}
                    {account.actions
                      .filter((a) => a.key === "create-workspace")
                      .map((a) => (
                        <DropdownMenuItem key={a.key} onClick={() => void a.run()}>
                          <a.icon className="h-4 w-4" /> {a.label}
                        </DropdownMenuItem>
                      ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>

            {account.showRoleSwitcher && (
              <div className="rounded-lg border border-border bg-card p-3">
                <RoleSwitcher embedded />
              </div>
            )}

            <div className="flex flex-col">
              {account.actions
                .filter((a) => a.key !== "create-workspace")
                .map((a) => (
                  <button
                    key={a.key}
                    type="button"
                    onClick={() => runAndClose(a.run)}
                    className="flex min-h-11 items-center gap-2.5 rounded-lg px-2 text-left text-[14px] text-foreground hover:bg-foreground/5"
                  >
                    <a.icon className="h-[18px] w-[18px] shrink-0 text-muted-foreground" /> {a.label}
                  </button>
                ))}

              {/* Тема — сегментом, все три варианта видны сразу. */}
              <div className="flex min-h-11 items-center gap-2.5 px-2 text-[14px]">
                <span className="flex-1">Тема</span>
                <div className="flex rounded-lg border border-border p-0.5">
                  {account.themes.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      onClick={t.select}
                      aria-pressed={t.active}
                      aria-label={t.label}
                      title={t.label}
                      className={cn(
                        "flex h-9 w-11 items-center justify-center rounded-md transition-colors duration-200",
                        t.active ? "bg-primary/15 text-primary" : "text-muted-foreground"
                      )}
                    >
                      <t.icon className="h-4 w-4" />
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={() => runAndClose(account.shortcuts.run)}
                className="flex min-h-11 items-center gap-2.5 rounded-lg px-2 text-left text-[14px] text-foreground hover:bg-foreground/5"
              >
                <account.shortcuts.icon className="h-[18px] w-[18px] shrink-0 text-muted-foreground" /> {account.shortcuts.label}
              </button>
              <button
                type="button"
                onClick={() => runAndClose(account.signOut.run)}
                className="flex min-h-11 items-center gap-2.5 rounded-lg px-2 text-left text-[14px] text-destructive hover:bg-destructive/10"
              >
                <account.signOut.icon className="h-[18px] w-[18px] shrink-0" /> {account.signOut.label}
              </button>
            </div>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
