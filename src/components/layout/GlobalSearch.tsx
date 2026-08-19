import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Search } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { useWorkspace } from "@/hooks/useWorkspace";
import { usePermissions } from "@/hooks/usePermissions";
import { PAGE_ICON_MAP } from "@/utils/pageIcons";
import type { PageIconName } from "@/types";

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { pages, members } = useWorkspace();
  const permissions = usePermissions();
  const navigate = useNavigate();

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

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="flex w-full max-w-sm items-center gap-2 rounded-full border border-input bg-background px-3.5 py-1.5 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground">
          <Search className="h-3.5 w-3.5" />
          <span className="flex-1 text-left">Поиск по страницам и людям…</span>
          <kbd className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px]">Ctrl K</kbd>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-2">
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Начните вводить…"
          className="mb-2"
        />
        <div className="max-h-72 overflow-y-auto scrollbar-thin">
          {filteredPages.length > 0 && (
            <div className="mb-1">
              <p className="px-1 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Страницы
              </p>
              {filteredPages.map((p) => {
                const Icon = PAGE_ICON_MAP[(p.icon as PageIconName) ?? "LayoutGrid"] ?? PAGE_ICON_MAP.LayoutGrid;
                return (
                  <button
                    key={p.id}
                    onClick={() => {
                      navigate(`/page/${p.id}`);
                      setOpen(false);
                      setQuery("");
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                  >
                    <Icon className="h-4 w-4" style={{ color: `hsl(${p.color})` }} />
                    {p.name}
                  </button>
                );
              })}
            </div>
          )}
          {filteredMembers.length > 0 && (
            <div>
              <p className="px-1 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Участники
              </p>
              {filteredMembers.map((m) => (
                <div key={m.uid || m.email} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-medium">
                    {m.name[0]?.toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate">{m.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
          {query && filteredPages.length === 0 && filteredMembers.length === 0 && (
            <p className="px-2 py-4 text-center text-sm text-muted-foreground">Ничего не найдено</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
