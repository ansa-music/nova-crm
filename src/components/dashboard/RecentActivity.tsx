import { useRef } from "react";
import { History, Pencil, Plus, Trash2 } from "lucide-react";
import { deskEase, gsap, useGSAP } from "@/lib/gsap";
import { timeAgo } from "@/utils/date";
import type { HistoryEntry } from "@/types";

const ACTION_ICON = {
  create: Plus,
  update: Pencil,
  delete: Trash2,
  restore: History,
} as const;

function lineFor(entry: HistoryEntry) {
  const who = entry.userName?.trim();
  const actor = who || "Кто-то";
  const place = entry.pageName ? ` в «${entry.pageName}»` : "";
  if (entry.action === "create") return `${actor} добавил(а) запись${place}`;
  if (entry.action === "delete") return `${actor} удалил(а) запись${place}`;
  if (entry.action === "restore") return `${actor} восстановил(а) значение${place}`;
  const field = entry.fieldLabel ?? entry.field;
  return field ? `${actor} изменил(а) «${field}»${place}` : `${actor} изменил(а) запись${place}`;
}

export function RecentActivity({ entries }: { entries: HistoryEntry[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      const nodes = ref.current?.querySelectorAll(".feed-item");
      if (!nodes?.length) return;
      gsap.fromTo(nodes, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.28, stagger: 0.04, ease: deskEase });
    },
    { scope: ref, dependencies: [entries.length] }
  );

  return (
    <div ref={ref} className="desk-cluster lift-card p-5">
      <p className="eyebrow mb-1 text-primary">Лента</p>
      <p className="section mb-4">Что менялось</p>
      {entries.length === 0 && (
        <p className="body py-4">Изменений пока нет</p>
      )}
      <div className="flex flex-col gap-0.5">
        {entries.slice(0, 8).map((entry) => {
          const Icon = ACTION_ICON[entry.action];
          return (
            <div key={entry.id} className="feed-item flex items-start gap-3">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border/70 bg-muted/40">
                <Icon className="h-3 w-3" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] leading-5">{lineFor(entry)}</p>
                <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">{timeAgo(entry.timestamp)}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
