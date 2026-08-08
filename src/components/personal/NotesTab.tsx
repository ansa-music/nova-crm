import { useEffect, useMemo, useState } from "react";
import { Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  deletePersonalNote,
  savePersonalNote,
  subscribeToPersonalNotes,
  type PersonalNote,
} from "@/services/personalSpaceService";
import { generateId } from "@/utils/id";
import { formatDate } from "@/utils/date";
import { cn } from "@/utils/cn";

interface NotesTabProps {
  workspaceId: string;
  pageId: string;
  uid: string;
}

export function NotesTab({ workspaceId, pageId, uid }: NotesTabProps) {
  const [notes, setNotes] = useState<PersonalNote[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"new" | "old">("new");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");

  useEffect(() => subscribeToPersonalNotes(workspaceId, pageId, uid, setNotes), [workspaceId, pageId, uid]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return notes
      .filter((n) => !q || n.title.toLowerCase().includes(q) || n.text.toLowerCase().includes(q))
      .sort((a, b) => (sort === "new" ? b.updatedAt - a.updatedAt : a.updatedAt - b.updatedAt));
  }, [notes, search, sort]);

  const selected = notes.find((n) => n.id === selectedId) ?? null;

  useEffect(() => {
    setTitle(selected?.title ?? "");
    setText(selected?.text ?? "");
  }, [selected?.id]);

  function handleNew() {
    setSelectedId(null);
    setTitle("");
    setText("");
  }

  async function handleSave() {
    if (!text.trim() && !title.trim()) return;
    const note: PersonalNote = {
      id: selectedId ?? generateId("note"),
      authorId: uid,
      pageId,
      title: title.trim() || "Без названия",
      text,
      createdAt: selected?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    };
    await savePersonalNote(workspaceId, pageId, note);
    setSelectedId(note.id);
  }

  async function handleDelete(note: PersonalNote) {
    if (!window.confirm(`Удалить заметку «${note.title}»?`)) return;
    await deletePersonalNote(workspaceId, pageId, uid, note.id);
    if (selectedId === note.id) handleNew();
  }

  return (
    <div className="flex h-full flex-col gap-3 sm:flex-row">
      <div className="flex w-full flex-col gap-2 sm:w-64 sm:shrink-0">
        <Button size="sm" className="gap-1.5" onClick={handleNew}>
          <Plus className="h-3.5 w-3.5" /> Новая заметка
        </Button>
        <div className="flex gap-1.5">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск..." className="h-8 pl-8 text-sm" />
          </div>
          <Select value={sort} onValueChange={(v) => setSort(v as "new" | "old")}>
            <SelectTrigger className="h-8 w-24 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="new">Новые</SelectItem>
              <SelectItem value="old">Старые</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1 overflow-y-auto">
          {filtered.map((n) => (
            <button
              key={n.id}
              onClick={() => setSelectedId(n.id)}
              className={cn(
                "flex flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left transition-colors",
                selectedId === n.id ? "bg-accent" : "hover:bg-accent/40"
              )}
            >
              <span className="truncate text-sm font-medium">{n.title}</span>
              <span className="truncate text-xs text-muted-foreground">{n.text.slice(0, 60)}</span>
            </button>
          ))}
          {filtered.length === 0 && <p className="p-3 text-center text-xs text-muted-foreground">Заметок нет</p>}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-2">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Заголовок" className="font-medium" />
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Текст заметки..."
          rows={12}
          className="flex-1 resize-none"
        />
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={handleSave}>
            Сохранить
          </Button>
          {selected && (
            <Button size="sm" variant="outline" className="gap-1.5 text-destructive" onClick={() => handleDelete(selected)}>
              <Trash2 className="h-3.5 w-3.5" /> Удалить
            </Button>
          )}
          {selected && (
            <span className="ml-auto text-xs text-muted-foreground">Изменено {formatDate(selected.updatedAt, "d MMM, HH:mm")}</span>
          )}
        </div>
      </div>
    </div>
  );
}
