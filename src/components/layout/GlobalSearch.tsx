import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import {
  LayoutDashboard,
  Megaphone,
  MessageCircle,
  MessageSquare,
  Search,
  Settings,
  Users,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useWorkspace } from "@/hooks/useWorkspace";
import { usePermissions } from "@/hooks/usePermissions";
import { usePeopleDesks } from "@/hooks/usePeopleDesks";
import { PAGE_ICON_MAP } from "@/utils/pageIcons";
import { cn } from "@/utils/cn";
import { useUiStore } from "@/store/uiStore";
import type { PageIconName } from "@/types";

type CommandItem = {
  id: string;
  kind: "go" | "page" | "person";
  label: string;
  hint?: string;
  href?: string;
  icon: typeof Search;
  color?: string;
  run?: () => void;
};

export function GlobalSearch({ hideTrigger = false }: { hideTrigger?: boolean }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const { pages, members } = useWorkspace();
  const permissions = usePermissions();
  const { selectPerson } = usePeopleDesks();
  const navigate = useNavigate();

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

  const destinations: CommandItem[] = useMemo(() => {
    const list: CommandItem[] = [
      { id: "home", kind: "go", label: "Главная", hint: "Твой стол", href: "/", icon: LayoutDashboard },
      { id: "dash", kind: "go", label: "Дашборд", href: "/dashboard", icon: LayoutDashboard },
      { id: "people", kind: "go", label: "Люди", href: "/people", icon: Users },
      { id: "ann", kind: "go", label: "Объявления", href: "/announcements", icon: Megaphone },
      { id: "chat", kind: "go", label: "Чат workspace", href: "/chat", icon: MessageSquare },
      { id: "msg", kind: "go", label: "Личные сообщения", href: "/messages", icon: MessageCircle },
      { id: "set", kind: "go", label: "Настройки", href: "/settings", icon: Settings },
    ];
    if (permissions.canManageWorkspace) {
      list.push({ id: "users", kind: "go", label: "Пользователи", href: "/users", icon: Users });
    }
    list.push({
      id: "keys",
      kind: "go",
      label: "Горячие клавиши",
      hint: "?",
      icon: Search,
      run: () => useUiStore.getState().setShortcutsHelpOpen(true),
    });
    return list;
  }, [permissions.canManageWorkspace]);

  const q = query.trim().toLowerCase();

  const filteredDest = useMemo(
    () => destinations.filter((d) => !q || d.label.toLowerCase().includes(q) || (d.hint ?? "").toLowerCase().includes(q)),
    [destinations, q]
  );

  const pageItems: CommandItem[] = useMemo(
    () =>
      pages
        .filter((p) => permissions.canAccessPage(p))
        .filter((p) => !q || p.name.toLowerCase().includes(q))
        .map((p) => ({
          id: p.id,
          kind: "page" as const,
          label: p.name,
          href: `/page/${p.id}`,
          icon: PAGE_ICON_MAP[(p.icon as PageIconName) ?? "LayoutGrid"] ?? PAGE_ICON_MAP.LayoutGrid,
          color: p.color,
        })),
    [pages, q, permissions]
  );

  const peopleItems: CommandItem[] = useMemo(() => {
    if (!q) return [];
    return members
      .filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.email.toLowerCase().includes(q) ||
          (m.nickname ?? "").toLowerCase().includes(q)
      )
      .map((m) => ({
        id: m.uid || m.email,
        kind: "person" as const,
        label: m.nickname || m.name,
        hint: m.email,
        href: permissions.canManageWorkspace ? "/users" : undefined,
        icon: Users,
        run:
          !permissions.canManageWorkspace && m.uid
            ? () => {
                selectPerson(m.uid);
                navigate("/");
              }
            : undefined,
      }));
  }, [members, q, permissions.canManageWorkspace, selectPerson, navigate]);

  const items = [...filteredDest, ...pageItems, ...peopleItems];
  const total = items.length;

  useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  function goItem(item: CommandItem) {
    if (item.run) item.run();
    if (item.href) navigate(item.href);
    setOpen(false);
    setQuery("");
  }

  return (
    <>
      {!hideTrigger && <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-8 w-full max-w-xl items-center gap-2 rounded-full border border-border/70 bg-background/40 px-3 text-[13px] text-muted-foreground transition-colors duration-200 hover:border-border hover:text-foreground"
      >
        <Search className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1 truncate text-left">Перейти…</span>
        <kbd className="hidden rounded border border-border px-1.5 py-0.5 font-mono text-[10px] tracking-wide sm:inline">
          Ctrl K
        </kbd>
      </button>}

      <Dialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) setQuery("");
        }}
      >
        <DialogContent className="glass-float top-[18%] max-w-xl translate-y-0 gap-0 overflow-hidden rounded-md p-0">
          <DialogTitle className="sr-only">Командный центр</DialogTitle>
          <div className="border-b border-border/60 px-3 py-3">
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Стол, человек, главная, настройки…"
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
                  }
                }}
              />
            </div>
          </div>
          <div className="max-h-[22rem] overflow-y-auto p-2 scrollbar-thin">
            {filteredDest.length > 0 && (
              <div className="mb-1">
                <p className="eyebrow px-2 py-1.5">Перейти</p>
                {filteredDest.map((item) => {
                  const i = items.indexOf(item);
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      onClick={() => goItem(item)}
                      className={cn("command-item", i === activeIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/60")}
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.hint && <span className="font-mono text-[10px] text-muted-foreground">{item.hint}</span>}
                    </button>
                  );
                })}
              </div>
            )}
            {pageItems.length > 0 && (
              <div className="mb-1">
                <p className="eyebrow px-2 py-1.5">Столы</p>
                {pageItems.map((item) => {
                  const i = items.indexOf(item);
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      onClick={() => goItem(item)}
                      className={cn("command-item", i === activeIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/60")}
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: item.color ? `hsl(${item.color})` : undefined }} />
                      {item.label}
                    </button>
                  );
                })}
              </div>
            )}
            {peopleItems.length > 0 && (
              <div>
                <p className="eyebrow px-2 py-1.5">Люди</p>
                {peopleItems.map((item) => {
                  const i = items.indexOf(item);
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      onClick={() => goItem(item)}
                      className={cn("command-item", i === activeIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/60")}
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.hint && <span className="truncate font-mono text-[10px] text-muted-foreground">{item.hint}</span>}
                    </button>
                  );
                })}
              </div>
            )}
            {query && items.length === 0 && (
              <p className="px-2 py-10 text-center text-sm text-muted-foreground">Ничего не найдено</p>
            )}
          </div>
          <div className="flex items-center gap-3 border-t border-border/60 px-3 py-2 font-mono text-[10px] text-muted-foreground">
            <span>↑↓ двигать</span>
            <span>Enter открыть</span>
            <span>Esc закрыть</span>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
