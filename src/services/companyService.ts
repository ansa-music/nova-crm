import { doc, serverTimestamp, setDoc, updateDoc, writeBatch } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths } from "@/firebase/firestore";
import { supabaseRows } from "@/lib/supabaseRows";
import { addOwnWorkspaceId } from "@/services/authService";
import { seedDefaultWorkspacePages } from "@/services/onboardingService";
import { primeRowsBackendState } from "@/services/rows/rowsBackend";
import { isSbMissingError } from "@/services/sb/sbCollections";
import type { Workspace, WorkspaceRegion } from "@/types";

/**
 * Компании-арендаторы (SaaS этап 2, SQL 20261025_company_signup.sql).
 *
 * Новую компанию заводит человек с ОДНОРАЗОВЫМ кодом приглашения, который
 * выдаёт администратор платформы (Nurba) на странице «Платформа». Код лежит в
 * двух местах: `companyInvites/{код}` в Firestore (его смотрит правило
 * создания workspace) и `platform_invites` в Supabase (его смотрит
 * `rows_register_company`). Заводит обе записи админка, гасит обе —
 * регистрация.
 *
 * Id новой компании — `ws_{uid}_{случайное}`: по нему Supabase узнаёт
 * владельца, не видя Firestore (как `page_{uid}_…` у столов). Новая компания
 * сразу живёт на Supabase (`rowsBackend: "supabase"`): переноса строк ей не
 * нужно — строк ещё нет. Не прошла регистрация в Supabase (SQL не накатан,
 * сбой) — компания работает по-старому на Firestore, ничего не теряется.
 */

/** Алфавит кодов: без 0/O/1/I, чтобы код не путали на слух и на экране. */
export const COMPANY_CODE_RE = /^[A-HJ-NP-Z2-9]{10}$/;

/** Из того, что вставил человек («abcd-efgh 23», ссылка целиком), — код. */
export function normalizeCompanyCode(raw: string | null | undefined): string {
  const text = (raw ?? "").trim();
  const fromLink = text.match(/[?&]code=([A-Za-z0-9-]+)/);
  return (fromLink ? fromLink[1] : text).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function isCompanyCode(code: string): boolean {
  return COMPANY_CODE_RE.test(code);
}

/** Ссылка, которую администратор отдаёт компании. */
export function companyInviteLink(code: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "https://nurba-6e70d.web.app";
  return `${origin}/start?code=${code}`;
}

function randomSuffix(length = 12): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

/** Id новой компании: `ws_{uid}_{12 знаков}`. */
export function companyWorkspaceId(uid: string): string {
  return `ws_${uid}_${randomSuffix()}`;
}

/** Готовые регионы для формы регистрации (пояс IANA, валюта ISO 4217). */
export interface RegionPreset {
  id: string;
  label: string;
  region: Required<WorkspaceRegion>;
}

export const REGION_PRESETS: RegionPreset[] = [
  { id: "kz", label: "Казахстан · тенге ₸", region: { timeZone: "Asia/Almaty", currency: "KZT", locale: "ru-KZ" } },
  { id: "ru", label: "Россия, Москва · рубль ₽", region: { timeZone: "Europe/Moscow", currency: "RUB", locale: "ru-RU" } },
  { id: "uz", label: "Узбекистан · сум", region: { timeZone: "Asia/Tashkent", currency: "UZS", locale: "ru-UZ" } },
  { id: "kg", label: "Кыргызстан · сом", region: { timeZone: "Asia/Bishkek", currency: "KGS", locale: "ru-KG" } },
  { id: "by", label: "Беларусь · рубль Br", region: { timeZone: "Europe/Minsk", currency: "BYN", locale: "ru-BY" } },
  { id: "tr", label: "Турция · лира ₺", region: { timeZone: "Europe/Istanbul", currency: "TRY", locale: "ru-TR" } },
  { id: "ae", label: "ОАЭ, Дубай · дирхам", region: { timeZone: "Asia/Dubai", currency: "AED", locale: "ru-AE" } },
  { id: "usd", label: "Доллар США $ · время Алматы", region: { timeZone: "Asia/Almaty", currency: "USD", locale: "ru-KZ" } },
];

export class CompanyCodeError extends Error {
  constructor(message = "Код не подошёл: он неверный, отозван или уже использован. Попросите новый у Nova.") {
    super(message);
    this.name = "CompanyCodeError";
  }
}

function isPermissionDenied(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? "";
  return code === "permission-denied" || code === "not-found" || /permission|not-found|No document/i.test(String((error as Error)?.message ?? ""));
}

export interface RegisterCompanyInput {
  uid: string;
  email: string;
  ownerName: string;
  companyName: string;
  icon: string;
  color: string;
  /** Код приглашения; `null` — только у администратора платформы. */
  code: string | null;
  region?: WorkspaceRegion | null;
  /** Завести стартовые столы («Клиенты», «Проекты», «Финансы»). */
  seedDesks?: boolean;
}

export interface RegisterCompanyResult {
  workspace: Workspace;
  /** Как прошла регистрация в Supabase: `ok` — строки сразу там. */
  supabase: "ok" | "skipped" | "failed";
  trialUntil: string | null;
}

/**
 * Завести компанию. Порядок важен: сначала Firestore (правило пускает только
 * со свободным кодом и в одной пачке с его гашением), потом Supabase, и
 * только после удачной регистрации там — `rowsBackend: "supabase"`.
 */
export async function registerCompany(input: RegisterCompanyInput): Promise<RegisterCompanyResult> {
  if (!db) throw new Error("Firebase не настроен");
  const code = input.code ? normalizeCompanyCode(input.code) : "";
  if (input.code !== null && !isCompanyCode(code)) throw new CompanyCodeError("Код — 10 букв и цифр, как в приглашении.");
  const id = companyWorkspaceId(input.uid);
  const name = input.companyName.trim().slice(0, 80);
  const region = input.region && (input.region.timeZone || input.region.currency) ? input.region : null;
  const workspace: Workspace = {
    id,
    name,
    icon: input.icon,
    color: input.color,
    ownerId: input.uid,
    createdAt: Date.now(),
    ...(region ? { region } : {}),
  };
  const docData = {
    ...workspace,
    createdAt: serverTimestamp(),
    ...(code ? { companyInvite: code } : {}),
  };

  try {
    if (code) {
      const batch = writeBatch(db);
      batch.set(paths.workspace(id), docData);
      batch.update(doc(db, "companyInvites", code), { usedBy: input.uid, usedAt: Date.now(), workspaceId: id });
      await batch.commit();
    } else {
      await setDoc(paths.workspace(id), docData);
    }
  } catch (error) {
    if (code && isPermissionDenied(error)) throw new CompanyCodeError();
    throw error;
  }

  await setDoc(paths.member(id, input.uid), {
    uid: input.uid,
    email: input.email,
    name: input.ownerName,
    role: "owner",
    status: "active",
    invitedAt: Date.now(),
    invitedBy: input.uid,
    joinedAt: Date.now(),
  });
  await addOwnWorkspaceId(input.uid, id);

  let supabase: RegisterCompanyResult["supabase"] = "skipped";
  let trialUntil: string | null = null;
  try {
    const { data, error } = await supabaseRows.rpc("rows_register_company", {
      p_workspace: id,
      p_code: code,
      p_name: name,
    });
    if (error) throw error;
    const result = (data ?? {}) as { status?: string; trial_until?: string | null };
    if (result.status === "registered" || result.status === "already") {
      trialUntil = result.trial_until ?? null;
      await updateDoc(paths.workspace(id), { rowsBackend: "supabase" });
      primeRowsBackendState(id, "supabase", false);
      supabase = "ok";
    } else {
      supabase = "failed";
    }
  } catch (error) {
    supabase = isSbMissingError(error as never) ? "skipped" : "failed";
    console.warn("[company] регистрация в Supabase не прошла — компания работает на Firestore", error);
  }

  if (input.seedDesks !== false) {
    try {
      await seedDefaultWorkspacePages(id, input.uid);
    } catch (error) {
      console.warn("[company] стартовые столы не заведены", error);
    }
  }

  return { workspace, supabase, trialUntil };
}

// ---------------------------------------------------------------------------
// Админка платформы — только администратор (Supabase проверяет почту токена,
// Firestore — правило `isPlatformAdmin`).
// ---------------------------------------------------------------------------

export interface CompanyInvite {
  code: string;
  note: string;
  trialDays: number;
  seatsLimit: number | null;
  createdAt: string;
  usedBy: string | null;
  usedAt: string | null;
  workspaceId: string | null;
  workspaceName: string | null;
  revokedAt: string | null;
  /** Именной код — выдан по заявке этому человеку (SaaS этап 3). */
  forUid: string | null;
}

function mapInvite(raw: Record<string, unknown>): CompanyInvite {
  return {
    code: String(raw.code ?? ""),
    note: String(raw.note ?? ""),
    trialDays: Number(raw.trial_days ?? 14),
    seatsLimit: raw.seats_limit == null ? null : Number(raw.seats_limit),
    createdAt: String(raw.created_at ?? ""),
    usedBy: (raw.used_by as string | null) ?? null,
    usedAt: (raw.used_at as string | null) ?? null,
    workspaceId: (raw.workspace_id as string | null) ?? null,
    workspaceName: (raw.workspace_name as string | null) ?? null,
    revokedAt: (raw.revoked_at as string | null) ?? null,
    forUid: (raw.for_uid as string | null) ?? null,
  };
}

/** Разворачивает ответ `setof jsonb` в любом виде, в каком его отдаёт PostgREST. */
function unwrapRows(data: unknown): Record<string, unknown>[] {
  if (!Array.isArray(data)) return [];
  return data.map((item) => {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const obj = item as Record<string, unknown>;
      const keys = Object.keys(obj);
      // `setof jsonb` иногда приходит как [{ имя_функции: {...} }].
      if (keys.length === 1 && obj[keys[0]] && typeof obj[keys[0]] === "object") return obj[keys[0]] as Record<string, unknown>;
      return obj;
    }
    return {};
  });
}

export async function createCompanyInvite(input: {
  uid: string;
  note: string;
  trialDays: number;
  seatsLimit: number | null;
}): Promise<CompanyInvite> {
  if (!db) throw new Error("Firebase не настроен");
  const { data, error } = await supabaseRows.rpc("platform_invite_create", {
    p_note: input.note,
    p_trial_days: input.trialDays,
    p_seats_limit: input.seatsLimit,
  });
  if (error) throw error;
  const invite = mapInvite((data ?? {}) as Record<string, unknown>);
  if (!isCompanyCode(invite.code)) throw new Error("База не вернула код приглашения");
  try {
    await setDoc(doc(db, "companyInvites", invite.code), {
      code: invite.code,
      note: invite.note,
      trialDays: invite.trialDays,
      seatsLimit: invite.seatsLimit,
      createdAt: Date.now(),
      createdBy: input.uid,
      usedBy: null,
      revoked: false,
      forUid: null,
    });
  } catch (firestoreError) {
    // Без копии в Firestore код бесполезен (правило создания workspace его не
    // найдёт) — гасим и в Supabase, чтобы в списке не висел «свободный».
    await supabaseRows.rpc("platform_invite_revoke", { p_code: invite.code });
    throw firestoreError;
  }
  return invite;
}

export async function listCompanyInvites(): Promise<CompanyInvite[]> {
  const { data, error } = await supabaseRows.rpc("platform_invite_list");
  if (error) throw error;
  return unwrapRows(data).map(mapInvite);
}

export async function revokeCompanyInvite(code: string): Promise<void> {
  if (!db) throw new Error("Firebase не настроен");
  const { error } = await supabaseRows.rpc("platform_invite_revoke", { p_code: code });
  if (error) throw error;
  await updateDoc(doc(db, "companyInvites", code), { revoked: true });
}

export type TenantStatus = "active" | "trial" | "suspended";

export interface Tenant {
  workspaceId: string;
  name: string | null;
  ownerId: string;
  plan: string;
  status: TenantStatus;
  trialUntil: string | null;
  seatsLimit: number | null;
  createdAt: string;
  members: number;
  activeNow: boolean;
  timezone: string;
  currency: string;
}

function mapTenant(raw: Record<string, unknown>): Tenant {
  return {
    workspaceId: String(raw.workspace_id ?? ""),
    name: (raw.name as string | null) ?? null,
    ownerId: String(raw.owner_id ?? ""),
    plan: String(raw.plan ?? "internal"),
    status: (String(raw.status ?? "active") as TenantStatus),
    trialUntil: (raw.trial_until as string | null) ?? null,
    seatsLimit: raw.seats_limit == null ? null : Number(raw.seats_limit),
    createdAt: String(raw.created_at ?? ""),
    members: Number(raw.members ?? 0),
    activeNow: raw.active_now !== false,
    timezone: String(raw.timezone ?? "Asia/Almaty"),
    currency: String(raw.currency ?? "KZT"),
  };
}

export async function listTenants(): Promise<Tenant[]> {
  const { data, error } = await supabaseRows.rpc("platform_tenants");
  if (error) throw error;
  return unwrapRows(data).map(mapTenant);
}

export interface TenantPatch {
  status?: TenantStatus;
  plan?: string;
  /** undefined — не трогать; null — снять дату. */
  trialUntil?: string | null;
  /** undefined — не трогать; null — без предела. */
  seatsLimit?: number | null;
}

export async function setTenant(workspaceId: string, patch: TenantPatch): Promise<void> {
  const { error } = await supabaseRows.rpc("platform_set_tenant", {
    p_workspace: workspaceId,
    p_status: patch.status ?? null,
    p_plan: patch.plan ?? null,
    p_trial_until: patch.trialUntil ?? null,
    p_seats_limit: patch.seatsLimit ?? null,
    p_set_trial: patch.trialUntil !== undefined,
    p_set_seats: patch.seatsLimit !== undefined,
  });
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Заявки на подключение (SaaS этап 3, SQL 20261028_platform_leads.sql):
// человек без кода оставляет заявку на /start, администратор одобряет —
// база выдаёт код на его имя, и /start сам предлагает завести компанию.
// ---------------------------------------------------------------------------

export type LeadStatus = "pending" | "approved" | "rejected";

export interface PlatformLead {
  uid: string;
  email: string;
  name: string;
  company: string;
  contact: string;
  note: string;
  status: LeadStatus;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  inviteCode: string | null;
  /** Компания, заведённая по выданному коду (если уже завели). */
  workspaceId: string | null;
}

function mapLead(raw: Record<string, unknown>): PlatformLead {
  const status = String(raw.status ?? "pending");
  return {
    uid: String(raw.uid ?? ""),
    email: String(raw.email ?? ""),
    name: String(raw.name ?? ""),
    company: String(raw.company ?? ""),
    contact: String(raw.contact ?? ""),
    note: String(raw.note ?? ""),
    status: status === "approved" || status === "rejected" ? status : "pending",
    createdAt: String(raw.created_at ?? ""),
    updatedAt: String(raw.updated_at ?? ""),
    resolvedAt: (raw.resolved_at as string | null) ?? null,
    inviteCode: (raw.invite_code as string | null) ?? null,
    workspaceId: (raw.workspace_id as string | null) ?? null,
  };
}

/** Своя заявка и код на своё имя — что показать на /start. */
export interface MyPlatformStatus {
  lead: PlatformLead | null;
  invite: { code: string; trialDays: number; seatsLimit: number | null; note: string } | null;
}

export async function fetchMyPlatformStatus(): Promise<MyPlatformStatus | null> {
  const { data, error } = await supabaseRows.rpc("platform_my_status");
  if (error) {
    if (isSbMissingError(error)) return null;
    throw error;
  }
  const raw = (data ?? null) as { lead?: Record<string, unknown> | null; invite?: Record<string, unknown> | null } | null;
  if (!raw) return { lead: null, invite: null };
  const inv = raw.invite;
  return {
    lead: raw.lead ? mapLead(raw.lead) : null,
    invite: inv && isCompanyCode(String(inv.code ?? ""))
      ? {
          code: String(inv.code),
          trialDays: Number(inv.trial_days ?? 14),
          seatsLimit: inv.seats_limit == null ? null : Number(inv.seats_limit),
          note: String(inv.note ?? ""),
        }
      : null,
  };
}

export async function submitLead(input: { company: string; contact: string; note: string; email: string; name: string }): Promise<PlatformLead> {
  const { data, error } = await supabaseRows.rpc("platform_lead_submit", {
    p_company: input.company,
    p_contact: input.contact,
    p_note: input.note,
    p_email: input.email,
    p_name: input.name,
  });
  if (error) {
    if (isSbMissingError(error)) throw new Error("Приём заявок ещё не включён — напишите нам напрямую.");
    throw error;
  }
  return mapLead((data ?? {}) as Record<string, unknown>);
}

export async function listLeads(): Promise<PlatformLead[]> {
  const { data, error } = await supabaseRows.rpc("platform_leads_list");
  if (error) throw error;
  return unwrapRows(data).map(mapLead);
}

/** Одобрить заявку: база выдаёт именной код, копия кода — в Firestore (её смотрит правило создания workspace). */
export async function approveLead(input: { uid: string; adminUid: string; trialDays: number; seatsLimit: number | null }): Promise<CompanyInvite> {
  if (!db) throw new Error("Firebase не настроен");
  const { data, error } = await supabaseRows.rpc("platform_lead_resolve", {
    p_uid: input.uid,
    p_approve: true,
    p_trial_days: input.trialDays,
    p_seats_limit: input.seatsLimit,
  });
  if (error) throw error;
  const raw = (data ?? {}) as { invite?: Record<string, unknown> };
  const invite = mapInvite(raw.invite ?? {});
  if (!isCompanyCode(invite.code)) throw new Error("База не вернула код приглашения");
  await setDoc(doc(db, "companyInvites", invite.code), {
    code: invite.code,
    note: invite.note,
    trialDays: invite.trialDays,
    seatsLimit: invite.seatsLimit,
    createdAt: Date.now(),
    createdBy: input.adminUid,
    usedBy: null,
    revoked: false,
    forUid: input.uid,
  });
  return invite;
}

export async function rejectLead(uid: string): Promise<void> {
  const { error } = await supabaseRows.rpc("platform_lead_resolve", {
    p_uid: uid,
    p_approve: false,
    p_trial_days: null,
    p_seats_limit: null,
  });
  if (error) throw error;
}
