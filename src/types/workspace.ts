import type { Role } from "@/types/role";
import type { StatusOption } from "@/types/page";

/**
 * An Owner-defined custom option field — the same idea as the built-in
 * "Статус"/"Ответственный" (one shared list, one badge+dropdown UI), but
 * for whatever the Owner wants to call it: "Приоритет", "Источник",
 * "Отдел", anything. A PageColumn of type "custom" points at one of these
 * via `customFieldId`; the field's own `options` list is what actually
 * populates the dropdown (see src/utils/columnOptions.ts).
 */
export interface CustomFieldDef {
  id: string;
  name: string;
  options: StatusOption[];
}

export interface Workspace {
  id: string;
  name: string;
  icon: string;
  color: string;
  ownerId: string;
  createdAt: number;
  /**
   * Shared, site-wide list of "Ответственный" options. Unlike a status
   * column's `statusOptions` (per-column, set once at creation), this one
   * list is used by EVERY "responsible"-type column across every page on
   * the whole site — add a name here and it's instantly available
   * everywhere. Only the Owner may write it (enforced by the same
   * `allow update: if isOwner(workspaceId)` rule as the rest of this doc);
   * managed from Настройки → Workspace → «Ответственные».
   */
  responsibleOptions?: StatusOption[];
  /**
   * Same idea, for "Статус" columns: ONE shared, site-wide list instead of
   * each column keeping its own. Every "Статус" column on every page/
   * subpage shows this list; managed from Настройки → Workspace →
   * «Статусы», Owner-only.
   */
  statusOptions?: StatusOption[];
  /**
   * Overrides the product's default cyan accent (--primary/--ring)
   * with an Owner-chosen preset. An HSL triplet ("221 83% 58%"), applied at
   * runtime by AccentColorSync — never baked into index.css, so every
   * other workspace keeps the default until its own Owner picks one.
   */
  accentColor?: string;
  /**
   * Which page's rows feed the Dashboard's revenue chart / status
   * breakdown. Before this existed the Dashboard guessed by matching page
   * names containing "клиент"/"проект", which broke the moment a page was
   * renamed to anything else — Owner now picks explicitly from Настройки
   * or right on the Dashboard itself.
   */
  dashboardClientsPageId?: string;
  dashboardProjectsPageId?: string;
  /** Owner-defined custom option fields — see CustomFieldDef above. */
  customFields?: CustomFieldDef[];
}

export type MemberStatus = "active" | "invited";

export interface WorkspaceMember {
  uid: string;
  email: string;
  name: string;
  nickname?: string;
  photoURL?: string | null;
  role: Role;
  status: MemberStatus;
  invitedAt: number;
  invitedBy: string;
  joinedAt?: number;
  /** Present only while status === 'invited'; used as the accept-invite token. */
  inviteToken?: string;
  /** Self-reported heartbeat timestamp, refreshed periodically while the app is open. Drives the online/away/offline indicator. */
  lastActiveAt?: number;
  /**
   * Purely personal, client-display preference: page ids this member has
   * chosen to hide from their OWN sidebar. Never affects anyone else's
   * access or visibility — an Owner still has full real access to a page
   * they've hidden for themselves, it's just tucked away behind "Показать
   * скрытые" in the sidebar. Self-writable (see the member self-service
   * rule in firestore.rules) since it carries no security weight.
   */
  hiddenPageIds?: string[];
  /**
   * Optional simulated role for testing/UX purposes ONLY — see
   * "Переключение режима привилегий". This is a self-writable, client-
   * visible field and MUST NEVER be trusted by Firestore Rules or any
   * server-side permission check: those always read `role` (above), which
   * only the Owner can change. `activeRole` only affects what the CLIENT
   * shows/attempts; the real Firestore-level access for this account is
   * always governed by `role`. Firestore Rules additionally cap which
   * values a member may set here to those their real `role` is allowed to
   * simulate (Owner: any; Admin: admin/manager/viewer; Manager/Viewer: not
   * allowed to set this field at all) — see the self-service member update
   * rule. Absent/null means "not simulating — use my real role".
   */
  activeRole?: Role | null;
}

export type JoinRequestStatus = "pending" | "approved" | "rejected";

/**
 * Someone who followed a workspace's shareable join link and asked to be let
 * in, before an Owner has approved them as an actual member. Anyone signed
 * in may create their own request doc; only the workspace Owner can read the
 * list, approve (which creates a real WorkspaceMember), or reject it.
 */
export interface JoinRequest {
  id: string;
  uid: string;
  email: string;
  name: string;
  photoURL?: string | null;
  workspaceId: string;
  status: JoinRequestStatus;
  requestedAt: number;
}
