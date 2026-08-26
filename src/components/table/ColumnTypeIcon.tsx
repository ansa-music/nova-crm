import type { LucideIcon } from "lucide-react";
import {
  BadgeCheck,
  Banknote,
  Calendar,
  Hash,
  Link2,
  Mail,
  Phone,
  Shapes,
  Type,
  User,
} from "lucide-react";
import { cn } from "@/utils/cn";
import { BASE_COLUMN_TYPE_LABELS } from "@/utils/columnOptions";
import type { ColumnType } from "@/types";

const TYPE_ICON: Record<ColumnType, LucideIcon> = {
  text: Type,
  number: Hash,
  currency: Banknote,
  status: BadgeCheck,
  responsible: User,
  date: Calendar,
  email: Mail,
  phone: Phone,
  url: Link2,
  custom: Shapes,
};

/** Per-type accent. Cyan for status/url (HUD), green money, amber people, sky dates. */
const TYPE_COLOR: Record<ColumnType, string> = {
  text: "text-muted-foreground",
  number: "text-sky-400",
  currency: "text-emerald-400",
  status: "text-primary",
  responsible: "text-amber-400",
  date: "text-sky-300",
  email: "text-cyan-300",
  phone: "text-teal-300",
  url: "text-primary",
  custom: "text-primary/80",
};

export function columnTypeLabel(type: ColumnType, customName?: string): string {
  if (type === "custom") return customName?.trim() || "Кастомное";
  return BASE_COLUMN_TYPE_LABELS[type];
}

export function ColumnTypeIcon({
  type,
  className,
  title,
}: {
  type: ColumnType;
  className?: string;
  title?: string;
}) {
  const Icon = TYPE_ICON[type] ?? Type;
  const label = title ?? columnTypeLabel(type);
  return (
    <span className="inline-flex shrink-0" title={label}>
      <Icon className={cn("h-3.5 w-3.5 shrink-0", TYPE_COLOR[type], className)} aria-hidden />
    </span>
  );
}
