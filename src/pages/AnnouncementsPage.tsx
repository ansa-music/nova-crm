import { useMemo, useState } from "react";
import { Archive, ArchiveRestore, Megaphone, Pencil, Pin, Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/sonner";
import { AnnouncementDialog } from "@/components/announcements/AnnouncementDialog";
import { useWorkspace } from "@/hooks/useWorkspace";
import { usePermissions } from "@/hooks/usePermissions";
import { useAnnouncements } from "@/hooks/useAnnouncements";
import { archiveAnnouncement, deleteAnnouncement, togglePinAnnouncement } from "@/services/announcementService";
import { formatDate } from "@/utils/date";
import { cn } from "@/utils/cn";
import type { Announcement, AnnouncementPriority } from "@/types";

const PRIORITY_STYLES: Record<AnnouncementPriority, { label: string; badge: string; border: string }> = {
  normal: { label: "Обычный", badge: "bg-muted text-muted-foreground", border: "border-border" },
  important: { label: "Важный", badge: "bg-amber-500/15 text-amber-500", border: "border-amber-500/30" },
  urgent: { label: "Срочный", badge: "bg-secondary/20 text-secondary", border: "border-secondary/50" },
};

export default function AnnouncementsPage() {
  const { activeWorkspaceId } = useWorkspace();
  const permissions = usePermissions();
  const { announcements } = useAnnouncements(activeWorkspaceId);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"active" | "archived">("active");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return announcements
      .filter((a) => Boolean(a.isArchived) === (tab === "archived"))
      .filter((a) => !q || a.title.toLowerCase().includes(q) || a.body.toLowerCase().includes(q))
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return b.createdAt - a.createdAt;
      });
  }, [announcements, search, tab]);

  if (!activeWorkspaceId) return null;

  async function handleTogglePin(a: Announcement) {
    await togglePinAnnouncement(activeWorkspaceId!, a.id, !a.pinned);
  }
  async function handleArchive(a: Announcement) {
    await archiveAnnouncement(activeWorkspaceId!, a.id, !a.isArchived);
    toast.success(a.isArchived ? "Объявление восстановлено" : "Объявление в архиве");
  }
  async function handleDelete(a: Announcement) {
    if (!window.confirm(`Удалить объявление «${a.title}»?`)) return;
    await deleteAnnouncement(activeWorkspaceId!, a.id);
    toast.success("Объявление удалено");
  }

  return (
    <div className="flex h-full flex-col">
      <div className="page-header">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Megaphone className="h-4 w-4" />
        </span>
        <h1 className="page-title">Объявления</h1>
        <div className="flex-1" />
        {permissions.canManageAnnouncements && (
          <Button
            size="sm"
            className="gap-1.5"
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            <Plus className="h-4 w-4" /> Создать
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-3 border-b border-border px-6 py-3 sm:flex-row sm:items-center">
        <Tabs value={tab} onValueChange={(v) => setTab(v as "active" | "archived")}>
          <TabsList>
            <TabsTrigger value="active">Активные</TabsTrigger>
            <TabsTrigger value="archived">Архив</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск объявлений..." className="pl-8" />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto flex max-w-2xl flex-col gap-3">
          {filtered.map((a) => {
            const style = PRIORITY_STYLES[a.priority];
            return (
              <Card key={a.id} className={cn("hud-frame glass-panel border", style.border)}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <Avatar className="h-9 w-9 shrink-0">
                      <AvatarImage src={a.authorPhotoURL ?? undefined} />
                      <AvatarFallback>{a.authorName[0]?.toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {a.pinned && <Pin className="h-3.5 w-3.5 shrink-0 fill-secondary text-secondary" />}
                        <h3 className="font-semibold">{a.title}</h3>
                        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", style.badge)}>
                          {style.label}
                        </span>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{a.body}</p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {a.authorName} · {formatDate(a.createdAt)}
                      </p>
                    </div>
                    {permissions.canManageAnnouncements && (
                      <div className="flex shrink-0 gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Закрепить" onClick={() => handleTogglePin(a)}>
                          <Pin className={cn("h-3.5 w-3.5", a.pinned && "fill-secondary text-secondary")} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title="Редактировать"
                          onClick={() => {
                            setEditing(a);
                            setDialogOpen(true);
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Архив" onClick={() => handleArchive(a)}>
                          {a.isArchived ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive"
                          title="Удалить"
                          onClick={() => handleDelete(a)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {filtered.length === 0 && (
            <p className="py-16 text-center text-sm text-muted-foreground">
              {tab === "archived" ? "В архиве пока пусто" : "Пока нет объявлений"}
            </p>
          )}
        </div>
      </div>

      <AnnouncementDialog open={dialogOpen} onOpenChange={setDialogOpen} editing={editing} />
    </div>
  );
}
