import { History, Pencil, Plus, Trash2 } from "lucide-react";
import { timeAgo } from "@/utils/date";
import type { HistoryEntry } from "@/types";
import { usePersonName } from "@/hooks/usePersonName";

const ACTION_ICON = {
  create: Plus,
  update: Pencil,
  delete: Trash2,
  restore: History,
} as const;

function lineFor(entry: HistoryEntry, nameOf: (uid: string | null | undefined, fallback?: string | null) => string) {
  const who = nameOf(entry.userId, entry.userName);
  const actor = who && who !== "—" ? who : "Кто-то";
  const place = entry.pageName ? ` в «${entry.pageName}»` : "";
  if (entry.action === "create") return `${actor} добавил(а) запись${place}`;
  if (entry.action === "delete") return `${actor} удалил(а) запись${place}`;
  if (entry.action === "restore") return `${actor} восстановил(а) значение${place}`;
  const field = entry.fieldLabel ?? entry.field;
  return field ? `${actor} изменил(а) «${field}»${place}` : `${actor} изменил(а) запись${place}`;
}

/** Шаг «лесенки» появления пунктов ленты. */
const FEED_STAGGER_MS = 40;

export function RecentActivity({ entries }: { entries: HistoryEntry[] }) {
  const nameOf = usePersonName();
  // Появление — CSS (`.nova-fade-in`, только opacity) с задержкой по номеру.
  // Пункты с ключом по id: пришла новая запись — появляется она одна, а не
  // вся лента заново, как было у GSAP-твина на каждое изменение длины.
  return (
    <div className="desk-cluster hud-frame lift-card p-5">
      <p className="eyebrow mb-1 text-primary">Лента</p>
      <p className="section mb-4">Что менялось</p>
      {entries.length === 0 && (
        <p className="body py-4">Изменений пока нет</p>
      )}
      <div className="flex flex-col gap-0.5">
        {entries.slice(0, 8).map((entry, index) => {
          const Icon = ACTION_ICON[entry.action];
          return (
            <div
              key={entry.id}
              className="feed-item nova-fade-in flex items-start gap-3"
              style={{ animationDelay: `${index * FEED_STAGGER_MS}ms` }}
            >
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border/70 bg-muted/40">
                <Icon className="h-3 w-3" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] leading-5">{lineFor(entry, nameOf)}</p>
                <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">{timeAgo(entry.timestamp)}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
