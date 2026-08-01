import {
  Briefcase,
  Building2,
  ClipboardList,
  LayoutGrid,
  Rocket,
  Star,
  Target,
  UserCog,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { PageIconName } from "@/types";

export const PAGE_ICON_MAP: Record<PageIconName, LucideIcon> = {
  Users,
  Briefcase,
  Wallet,
  UserCog,
  LayoutGrid,
  Building2,
  Target,
  ClipboardList,
  Rocket,
  Star,
};

export const PAGE_ICON_NAMES = Object.keys(PAGE_ICON_MAP) as PageIconName[];
