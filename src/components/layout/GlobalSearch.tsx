import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Search } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { useWorkspace } from "@/hooks/useWorkspace";
import { usePermissions } from "@/hooks/usePermissions";
import { PAGE_ICON_MAP } from "@/utils/pageIcons";
import { cn } from "@/utils/cn";
import type { PageIconName } from "@/types";

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const { pages, members } = useWorkspace();
  const permissions = usePermissions();
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
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const filteredPages = useMemo(() => {
    const q = query.trim().toLowerCase();
    return pages
      .filter((p) => permissions.canAccessPage(p))
      .filter((p) => !q || p.name.toLowerCase().includes(q));
  }, [pages, query, permissions]);

  const filteredMembers = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return members.filter(
      (m) => m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q)
    );
  }, [members, query]);

  const pageItems = filteredPages.map((p) => ({
    id: p.id,
    kind: "page" as const,
    label: p.name,
    icon: PAGE_ICON_MAP[(p.icon as PageIconName) ?? "LayoutGrid"] ?? PAGE_ICON_MAP.LayoutGrid,
    color: p.color,
    href: `/page/${p.id}`,
  }));

  const items = pageItems;
  const total = items.length;

  useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  function go(href: string) {
    navigate(href);
    setOpen(false);
    setQuery("");
  }

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <button className="flex h-9 w-full max-w-md items-center gap-2 rounded-md border border-border/80 bg-background/60 px-3 text-sm text-muted-foreground transition-colors duration-200 hover:border-border hover:text-foreground">
          <Search className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1 truncate text-left">Поиск по страницам и людям…</span>
          <kbd className="hidden rounded border border-border px-1.5 py-0.5 font-mono text-[10px] tracking-wide sm:inline">
            Ctrl K
          </kbd>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(28rem,calc(100vw-2rem))] p-0">
        <div className="border-b border-border px-2 py-2">
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Начните вводить…"
            className="h-9 border-0 bg-transparent px-2 shadow-none focus-visible:ring-0"
            onKeyDown={(e) => {
              if (e.code === "ArrowDown") {
                e.preventDefault();
                setActiveIndex((i) => (total === 0 ? 0 : (i + 1) % total));
              } else if (e.code === "ArrowUp") {
                e.preventDefault();
                setActiveIndex((i) => (total === 0 ? 0 : (i - 1 + total) % total));
              } else if (e.code === "Enter" && items[activeIndex]) {
                e.preventDefault();
                go(items[activeIndex].href);
              }
            }}
          />
        </div>
        <div className="max-h-72 overflow-y-auto p-1.5 scrollbar-thin">
          {filteredPages.length > 0 && (
            <div className="mb-1">
              <p className="eyebrow px-2 py-1.5">Страницы</p>
              {pageItems.map((item, i) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    onClick={() => go(item.href)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                      i === activeIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/60"
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" style={{ color: `hsl(${item.color})` }} />
                    {item.label}
                  </button>
                );
              })}
            </div>
          )}
          {filteredMembers.length > 0 && (
            <div>
              <p className="eyebrow px-2 py-1.5">Участники</p>
              {filteredMembers.map((m) => (
                <div key={m.uid || m.email} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted font-mono text-[10px] font-medium">
                    {m.name[0]?.toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate">{m.name}</p>
                    <p className="truncate font-mono text-[11px] text-muted-foreground">{m.email}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
          {query && filteredPages.length === 0 && filteredMembers.length === 0 && (
            <p className="px-2 py-8 text-center text-sm text-muted-foreground">Ничего не найдено</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
