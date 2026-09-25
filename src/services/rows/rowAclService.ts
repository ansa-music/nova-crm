import { supabaseRows } from "@/lib/supabaseRows";
import { isSbMissingError } from "@/services/sb/sbCollections";
import type { Role, WorkspaceMember, WorkspacePage } from "@/types";

/**
 * Копия прав Firestore → Postgres, по которой политики `desk_rows` решают,
 * кто читает и правит строки стола (supabase/migrations/20260923_desk_rows.sql).
 *
 * Firestore остаётся источником правды: здесь мы только ДОВОДИМ копию до
 * него. Писать копию политики пускают ровно тех, кто в Firestore вправе
 * менять те же поля, поэтому сверка идёт из разных сессий по-разному:
 *  • Owner — всё: участники, столы, наблюдатели;
 *  • Тимлид — участники (кроме себя и Owner) и столы (кроме того, что
 *    Firestore ему не даёт: createdBy/osDesk, ответственный стола ОС);
 *  • ответственный за стол — СВОЙ стол: завести запись и списки доступа.
 *
 * Чего сверка НЕ делает никогда — не удаляет записи о столах: при неполном
 * списке столов (подписка ещё не догрузилась) это сняло бы права у всех.
 * Запись стола удаляется только вместе с самим столом (`deletePageAcl`).
 * Участников удаляет только по ПОЛНОМУ списку, прочитанному с сервера, и с
 * предохранителем от «убрать почти всех разом».
 */

export interface AclMemberRow {
  uid: string;
  role: Role;
  extra_roles: string[];
  /**
   * Ник ОС (`members.osNickValue`) — по нему политика `os_orders` отдаёт ОС
   * его списки заказов (20260930b_os_orders.sql). null — ника нет. Поля нет
   * (undefined) — в базе ещё нет столбца: SQL этой миграции не вставлен, и
   * сверка работает по-старому, без ника.
   */
  os_nick_value?: string | null;
}

export interface AclPageRow {
  page_id: string;
  responsible_uid: string | null;
  created_by: string | null;
  os_desk: boolean;
  allowed_uids: string[];
  editable_uids: string[];
  /**
   * Копия карты столбцов стола (`page.osFieldKeys`, SQL 20261002): вкладка,
   * столбец ОС и столбец статуса. По ней база проверяет, что ОС забирает
   * строку, где его ник стоит ИМЕННО в столбце ОС (`rows_os_claim_order`), а
   * не в имени клиента. У столов ОС — null. Поля нет (undefined) — в базе ещё
   * нет столбцов: сверка работает по-старому, без них.
   */
  os_keys_tab?: string | null;
  os_key?: string | null;
  os_status_key?: string | null;
}

export interface AclSyncReport {
  membersUpserted: number;
  membersRemoved: number;
  pagesUpserted: number;
  observersChanged: number;
  /** Что пропущено и почему — для экрана «Строки таблиц». */
  skipped: string[];
  errors: string[];
}

function sortedUnique(list: readonly string[] | null | undefined): string[] {
  return [...new Set((list ?? []).filter((v): v is string => typeof v === "string" && v.length > 0))].sort();
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * Участник в копии: всё, кроме приглашений по почте. Именно `!== "invited"`,
 * а не `=== "active"`: у старых документов участника поля `status` нет, а
 * Firestore (`isMember` — документ есть) и весь клиент считают их участниками.
 */
export function desiredMemberRows(members: readonly WorkspaceMember[]): AclMemberRow[] {
  const byUid = new Map<string, AclMemberRow>();
  for (const m of members) {
    if (!m?.uid || m.status === "invited" || m.uid.includes("@")) continue;
    byUid.set(m.uid, {
      uid: m.uid,
      role: m.role,
      extra_roles: sortedUnique((m.extraRoles ?? []).filter((r) => r === "manager" || r === "os")),
      // Как в правилах: пустой ник не открывает ничего, поэтому "" = нет ника.
      os_nick_value: typeof m.osNickValue === "string" && m.osNickValue ? m.osNickValue : null,
    });
  }
  return [...byUid.values()];
}

export function desiredPageRow(page: WorkspacePage): AclPageRow {
  // Карта столбцов — только у столов технарей: в стол ОС заказы не зеркалят.
  const keys = !page.osDesk ? (page.osFieldKeys ?? null) : null;
  return {
    page_id: page.id,
    responsible_uid: page.responsibleUserId ?? null,
    created_by: page.createdBy ?? null,
    os_desk: page.osDesk === true,
    allowed_uids: sortedUnique(page.allowedUsers),
    editable_uids: sortedUnique(page.editableUsers),
    os_keys_tab: keys?.tabId || null,
    os_key: keys?.os || null,
    os_status_key: keys?.status || null,
  };
}

export function samePageRow(a: AclPageRow, b: AclPageRow): boolean {
  return (
    a.responsible_uid === b.responsible_uid &&
    a.created_by === b.created_by &&
    a.os_desk === b.os_desk &&
    sameList(a.allowed_uids, b.allowed_uids) &&
    sameList(a.editable_uids, b.editable_uids) &&
    (a.os_keys_tab ?? null) === (b.os_keys_tab ?? null) &&
    (a.os_key ?? null) === (b.os_key ?? null) &&
    (a.os_status_key ?? null) === (b.os_status_key ?? null)
  );
}

function sameMemberRow(a: AclMemberRow, b: AclMemberRow): boolean {
  return a.role === b.role && sameList(a.extra_roles, b.extra_roles) && (a.os_nick_value ?? null) === (b.os_nick_value ?? null);
}

/**
 * Сколько участников сверка вправе убрать за раз. Список пришёл неполным
 * (ошибка чтения, чужой кэш) — «удалить всех, кого нет» сняло бы права у
 * половины людей; настоящая массовая чистка — редкость, её сделает Owner
 * кнопкой «Синхронизировать» после проверки.
 */
export function safeToRemove(current: number, toRemove: number): boolean {
  if (toRemove === 0) return true;
  return toRemove <= Math.max(3, Math.floor(current / 3));
}

/**
 * Решение сверки — чистая функция, чтобы её можно было проверить без базы.
 */
export function planMemberSync(
  desired: readonly AclMemberRow[],
  current: readonly AclMemberRow[],
  opts: {
    rosterComplete: boolean;
    /** `grantedOwner` — Owner, но не создатель workspace: записей Owner не трогает. */
    actor: "owner" | "grantedOwner" | "teamlead";
    me: string;
    ownerId: string;
    force?: boolean;
  }
): { upsert: AclMemberRow[]; remove: string[]; skipped: string[] } {
  const skipped: string[] = [];
  const currentByUid = new Map(current.map((m) => [m.uid, m]));
  const desiredUids = new Set(desired.map((m) => m.uid));
  // Тимлид не пишет себя, Owner и роль owner — как в firestore.rules.
  const teamleadMayTouch = (uid: string, role: Role | undefined) =>
    uid !== opts.me && uid !== opts.ownerId && role !== "owner";
  // Выданный Owner — как Тимлид, но себя (оставаясь Owner) править может:
  // роль owner выдаёт и забирает только создатель (20261003_owner_members.sql).
  const grantedMayTouch = (uid: string, role: Role | undefined) =>
    uid !== opts.ownerId && role !== "owner";

  const upsert = desired.filter((m) => {
    const cur = currentByUid.get(m.uid);
    if (cur && sameMemberRow(cur, m)) return false;
    if (opts.actor === "teamlead" && !(teamleadMayTouch(m.uid, m.role) && teamleadMayTouch(m.uid, cur?.role))) {
      skipped.push(`участник ${m.uid}: меняет только Owner`);
      return false;
    }
    if (
      opts.actor === "grantedOwner" &&
      !(grantedMayTouch(m.uid, m.role) && grantedMayTouch(m.uid, cur?.role)) &&
      !(m.uid === opts.me && m.role === "owner" && cur?.role === "owner")
    ) {
      skipped.push(`участник ${m.uid}: записи Owner меняет только создатель`);
      return false;
    }
    return true;
  });

  let remove = current.filter((m) => !desiredUids.has(m.uid)).map((m) => m.uid);
  if (!opts.rosterComplete) {
    if (remove.length) skipped.push(`убрать участников (${remove.length}): список участников ещё не прочитан целиком`);
    remove = [];
  } else if (!opts.force && !safeToRemove(current.length, remove.length)) {
    skipped.push(`убрать участников (${remove.length} из ${current.length}): слишком много разом — нажмите «Синхронизировать»`);
    remove = [];
  }
  if (opts.actor === "teamlead") {
    remove = remove.filter((uid) => {
      const ok = teamleadMayTouch(uid, currentByUid.get(uid)?.role);
      if (!ok) skipped.push(`убрать ${uid}: только Owner`);
      return ok;
    });
  } else if (opts.actor === "grantedOwner") {
    remove = remove.filter((uid) => {
      const ok = grantedMayTouch(uid, currentByUid.get(uid)?.role);
      if (!ok) skipped.push(`убрать ${uid}: только создатель`);
      return ok;
    });
  }
  return { upsert, remove, skipped };
}

/**
 * Какие записи столов писать. Owner — любые. Тимлид — кроме того, что
 * запретит триггер копии (createdBy/osDesk, ответственный стола ОС) и что не
 * пройдёт политику вставки (стол ОС не под своим `osdesk_{uid}`).
 * Ответственный (не руководство) — только свои столы и только списки доступа;
 * завести запись — только стола со своим uid в id (`generateDeskId`).
 * Admin вдобавок доводит переназначение ответственного (не стола ОС, без
 * смены списка правки) — ровно то, что ему даёт firestore.rules.
 */
export function planPageSync(
  pages: readonly WorkspacePage[],
  current: readonly AclPageRow[],
  opts: {
    actor: "owner" | "teamlead" | "admin" | "responsible";
    me: string;
    meHasOsRole?: boolean;
    /** В базе ещё нет столбцов карты столбцов (SQL 20261002 не вставлен). */
    withoutKeys?: boolean;
  }
): { upsert: AclPageRow[]; skipped: string[] } {
  const skipped: string[] = [];
  const currentById = new Map(current.map((p) => [p.page_id, p]));
  const upsert: AclPageRow[] = [];
  for (const page of pages) {
    const want = opts.withoutKeys ? withoutKeys(desiredPageRow(page)) : desiredPageRow(page);
    const cur = currentById.get(want.page_id);
    if (cur && samePageRow(cur, want)) continue;
    if (
      opts.actor === "admin" &&
      cur &&
      !cur.os_desk &&
      !want.os_desk &&
      cur.responsible_uid !== want.responsible_uid &&
      cur.created_by === want.created_by &&
      sameList(cur.editable_uids, want.editable_uids)
    ) {
      upsert.push(want);
      continue;
    }
    if (opts.actor === "responsible" || opts.actor === "admin") {
      if (want.responsible_uid !== opts.me) continue;
      if (!cur) {
        if (want.created_by !== opts.me) continue; // заведёт руководство
        const ownId = want.os_desk
          ? want.page_id === `osdesk_${opts.me}`
          : want.page_id.startsWith(`page_${opts.me}_`);
        if (!ownId) continue; // стол со старым id — заведёт руководство
        upsert.push(want);
        continue;
      }
      if (cur.responsible_uid !== want.responsible_uid || cur.created_by !== want.created_by || cur.os_desk !== want.os_desk) {
        continue; // это меняет руководство
      }
      upsert.push(want);
      continue;
    }
    if (opts.actor === "teamlead") {
      if (!cur) {
        if (want.os_desk && !(want.page_id === `osdesk_${want.responsible_uid}` && want.created_by === want.responsible_uid)) {
          skipped.push(`стол ${want.page_id}: такой стол ОС заводит только Owner`);
          continue;
        }
        // СВОЙ стол ОС Тимлид в копию не заводит: политика Supabase пускает
        // туда только того, у кого роль ОС есть сейчас (иначе любой Тимлид
        // выписал бы себе `osdesk_{свой uid}` и получил правку его строк).
        // Тимлид + ОС проходит веткой участника; у бывшего ОС запись заведёт
        // Owner — здесь это ОЖИДАЕМЫЙ пропуск, а не ошибка на каждой сверке.
        if (want.os_desk && want.responsible_uid === opts.me && !opts.meHasOsRole) {
          skipped.push(`стол ${want.page_id}: свой стол ОС заводит Owner`);
          continue;
        }
        upsert.push(want);
        continue;
      }
      if (cur.created_by !== want.created_by || cur.os_desk !== want.os_desk) {
        skipped.push(`стол ${want.page_id}: createdBy/osDesk меняет только Owner`);
        continue;
      }
      if (cur.os_desk && cur.responsible_uid !== want.responsible_uid) {
        skipped.push(`стол ${want.page_id}: ответственного стола ОС меняет только Owner`);
        continue;
      }
    }
    upsert.push(want);
  }
  return { upsert, skipped };
}

// ---------------------------------------------------------------------------
// Запись в Supabase
// ---------------------------------------------------------------------------

function describe(error: { message?: string; code?: string } | null | undefined): string {
  if (!error) return "неизвестная ошибка";
  return error.code ? `${error.message ?? ""} (${error.code})` : (error.message ?? "ошибка");
}

/*
 * Столбец ника ОС (`rows_members.os_nick_value`) появляется только с SQL
 * `20260930b_os_orders.sql`, а его Nurba вставляет руками. Пока столбца нет
 * (42703 / PGRST204), сверка и мгновенная запись участника работают
 * по-старому, без ника, — иначе ОДНО новое поле роняло бы всю копию прав
 * (роли, вторые роли) у всех. null — ещё не спрашивали.
 */
let nickColumn: boolean | null = null;
/** Когда сказали «столбца нет»: через 10 минут спрашиваем снова — SQL могли вставить. */
let nickColumnMissingAt = 0;
const NICK_COLUMN_RECHECK_MS = 10 * 60_000;

/** Для проверок: забыть, есть ли столбец ника. */
export function resetAclNickColumn() {
  nickColumn = null;
  nickColumnMissingAt = 0;
}

/**
 * «Столбца ника нет» — память модуля, а вкладка руководства живёт сутками.
 * Без срока ник после вставки SQL не копировался бы до перезагрузки, и ОС
 * видели бы свои заказы только через запасной Firestore.
 */
function refreshNickColumnMemory() {
  if (nickColumn === false && Date.now() - nickColumnMissingAt >= NICK_COLUMN_RECHECK_MS) nickColumn = null;
}

function markNickColumnMissing() {
  nickColumn = false;
  nickColumnMissingAt = Date.now();
}

function withoutNick(row: AclMemberRow): AclMemberRow {
  const rest = { ...row };
  delete rest.os_nick_value;
  return rest;
}

/*
 * Столбцы карты столбцов в `rows_page_acl` (`os_keys_tab`, `os_key`,
 * `os_status_key`) появляются только с SQL 20261002 — как и ник выше: пока их
 * нет (42703 / PGRST204), копия прав столов пишется и читается без них, иначе
 * ОДНО новое поле роняло бы сверку прав всех столов. Через 10 минут
 * спрашиваем снова. null — ещё не спрашивали.
 */
let keysColumn: boolean | null = null;
let keysColumnMissingAt = 0;

/** Для проверок: забыть, есть ли столбцы карты столбцов. */
export function resetAclKeysColumn() {
  keysColumn = null;
  keysColumnMissingAt = 0;
}

function refreshKeysColumnMemory() {
  if (keysColumn === false && Date.now() - keysColumnMissingAt >= NICK_COLUMN_RECHECK_MS) keysColumn = null;
}

function markKeysColumnMissing() {
  keysColumn = false;
  keysColumnMissingAt = Date.now();
}

function withoutKeys(row: AclPageRow): AclPageRow {
  const rest = { ...row };
  delete rest.os_keys_tab;
  delete rest.os_key;
  delete rest.os_status_key;
  return rest;
}

async function readMembers(workspaceId: string): Promise<AclMemberRow[]> {
  refreshNickColumnMemory();
  if (nickColumn !== false) {
    const { data, error } = await supabaseRows
      .from("rows_members")
      .select("uid, role, extra_roles, os_nick_value")
      .eq("workspace_id", workspaceId);
    if (!error) {
      nickColumn = true;
      return ((data ?? []) as AclMemberRow[]).map((m) => ({
        ...m,
        extra_roles: sortedUnique(m.extra_roles),
        os_nick_value: typeof m.os_nick_value === "string" && m.os_nick_value ? m.os_nick_value : null,
      }));
    }
    if (!isSbMissingError(error)) throw new Error(`копия участников не прочиталась: ${describe(error)}`);
    markNickColumnMissing();
  }
  const { data, error } = await supabaseRows
    .from("rows_members")
    .select("uid, role, extra_roles")
    .eq("workspace_id", workspaceId);
  if (error) throw new Error(`копия участников не прочиталась: ${describe(error)}`);
  return ((data ?? []) as AclMemberRow[]).map((m) => ({ ...m, extra_roles: sortedUnique(m.extra_roles) }));
}

const PAGE_COLUMNS = "page_id, responsible_uid, created_by, os_desk, allowed_uids, editable_uids";

async function readPages(workspaceId: string): Promise<AclPageRow[]> {
  const normalize = (p: AclPageRow): AclPageRow => ({
    ...p,
    allowed_uids: sortedUnique(p.allowed_uids),
    editable_uids: sortedUnique(p.editable_uids),
  });
  refreshKeysColumnMemory();
  if (keysColumn !== false) {
    const { data, error } = await supabaseRows
      .from("rows_page_acl")
      .select(`${PAGE_COLUMNS}, os_keys_tab, os_key, os_status_key`)
      .eq("workspace_id", workspaceId);
    if (!error) {
      keysColumn = true;
      return ((data ?? []) as AclPageRow[]).map((p) => ({
        ...normalize(p),
        os_keys_tab: p.os_keys_tab || null,
        os_key: p.os_key || null,
        os_status_key: p.os_status_key || null,
      }));
    }
    if (!isSbMissingError(error)) throw new Error(`копия прав столов не прочиталась: ${describe(error)}`);
    markKeysColumnMissing();
  }
  const { data, error } = await supabaseRows.from("rows_page_acl").select(PAGE_COLUMNS).eq("workspace_id", workspaceId);
  if (error) throw new Error(`копия прав столов не прочиталась: ${describe(error)}`);
  return ((data ?? []) as AclPageRow[]).map(normalize);
}

/**
 * Пишем пачкой, где политика пустит всю пачку (Owner), и по одной там, где
 * одна отклонённая запись не должна ронять остальные (Тимлид, ответственный).
 */
async function upsertRows<T extends object>(
  table: string,
  rows: T[],
  conflict: string,
  oneByOne: boolean,
  errors: string[],
  label: (row: T) => string
): Promise<number> {
  if (rows.length === 0) return 0;
  if (!oneByOne) {
    const { error } = await supabaseRows.from(table).upsert(rows, { onConflict: conflict });
    if (!error) return rows.length;
    errors.push(`${table}: ${describe(error)}`);
    return 0;
  }
  const keys = conflict.split(",");
  let done = 0;
  for (const row of rows) {
    const { error } = await supabaseRows.from(table).upsert([row], { onConflict: conflict });
    if (!error) {
      done += 1;
      continue;
    }
    // `upsert` — это INSERT ... ON CONFLICT: Postgres проверяет политику
    // ВСТАВКИ, даже когда запись уже есть и дело кончится правкой. Поэтому
    // ответственный за старый стол (его id не вида `page_{свой uid}_…`) не мог
    // обновить ДАЖЕ СВОЮ запись прав: сверка падала на каждом заходе. Правку
    // политика разрешает — пробуем ею, и только если строки нет, отказ честный.
    if (error.code === "42501") {
      const updated = await updateExisting(table, row, keys);
      if (updated === true) {
        done += 1;
        continue;
      }
    }
    errors.push(`${label(row)}: ${describe(error)}`);
  }
  return done;
}

/** Правка существующей записи по ключу. true — нашлась и обновлена. */
async function updateExisting<T extends object>(table: string, row: T, keys: string[]): Promise<boolean> {
  let q = supabaseRows.from(table).update(row);
  for (const key of keys) {
    const value = (row as Record<string, unknown>)[key];
    if (value === undefined) return false;
    q = q.eq(key, value as string);
  }
  const { data, error } = await q.select(keys[0]);
  return !error && Array.isArray(data) && data.length > 0;
}

export interface AclSyncInput {
  workspaceId: string;
  /** workspace.ownerId — Тимлид его не трогает. */
  ownerId: string;
  me: string;
  /** НАСТОЯЩАЯ роль (не симуляция): решает, что эта сессия вправе сверять. */
  realRole: Role;
  /**
   * Участники — ТОЛЬКО свежий список с сервера (`fetchMembersFresh`), не
   * ростер из памяти вкладки: по старому сверка вернула бы права убранному и
   * сняла бы их с только что одобренного. null — участников не сверять.
   */
  members: readonly WorkspaceMember[] | null;
  /** Все столы, включая неактуальные и столы ОС. */
  pages: readonly WorkspacePage[];
  /** Наблюдатели (uid) — только у Owner и только свежие с сервера; null — не сверять. */
  observers: readonly string[] | null;
  /** Кнопка «Синхронизировать»: снять предохранитель на массовое удаление. */
  force?: boolean;
}

export async function syncRowAcl(input: AclSyncInput): Promise<AclSyncReport> {
  const report: AclSyncReport = { membersUpserted: 0, membersRemoved: 0, pagesUpserted: 0, observersChanged: 0, skipped: [], errors: [] };
  const { workspaceId } = input;
  const actor =
    input.realRole === "owner"
      ? "owner"
      : input.realRole === "teamlead"
        ? "teamlead"
        : input.realRole === "admin"
          ? "admin"
          : "responsible";

  if ((actor === "owner" || actor === "teamlead") && input.members) {
    const currentMembers = await readMembers(workspaceId);
    // Столбца ника в базе нет — сравниваем и пишем без него (см. nickColumn).
    const desired = desiredMemberRows(input.members).map((m) => (nickColumn === false ? withoutNick(m) : m));
    const plan = planMemberSync(desired, currentMembers, {
      rosterComplete: true,
      actor: actor === "owner" && input.me !== input.ownerId ? "grantedOwner" : actor,
      me: input.me,
      ownerId: input.ownerId,
      force: input.force,
    });
    report.skipped.push(...plan.skipped);
    report.membersUpserted = await upsertRows(
      "rows_members",
      plan.upsert.map((m) => ({ workspace_id: workspaceId, ...m, updated_at: Date.now() })),
      "workspace_id,uid",
      actor !== "owner" || input.me !== input.ownerId,
      report.errors,
      (m) => `участник ${m.uid}`
    );
    if (plan.remove.length) {
      const { error } = await supabaseRows
        .from("rows_members")
        .delete()
        .eq("workspace_id", workspaceId)
        .in("uid", plan.remove);
      if (error) report.errors.push(`убрать участников: ${describe(error)}`);
      else report.membersRemoved = plan.remove.length;
    }
  }

  const currentPages = await readPages(workspaceId);
  const meHasOsRole = (input.members ?? []).some(
    (m) => m.uid === input.me && (m.role === "os" || (m.extraRoles ?? []).includes("os"))
  );
  // Столбцов карты столбцов в базе нет — сравниваем и пишем без них (см. keysColumn).
  const pagePlan = planPageSync(input.pages, currentPages, {
    actor,
    me: input.me,
    meHasOsRole,
    withoutKeys: keysColumn === false,
  });
  report.skipped.push(...pagePlan.skipped);
  report.pagesUpserted = await upsertRows(
    "rows_page_acl",
    pagePlan.upsert.map((p) => ({ workspace_id: workspaceId, ...p, updated_at: Date.now() })),
    "workspace_id,page_id",
    actor !== "owner",
    report.errors,
    (p) => `стол ${p.page_id}`
  );

  if (actor === "owner" && input.observers) {
    report.observersChanged = await syncObservers(workspaceId, input.observers, report.errors);
  }
  return report;
}

async function syncObservers(workspaceId: string, desired: readonly string[], errors: string[]): Promise<number> {
  const { data, error } = await supabaseRows.from("rows_desk_observers").select("uid").eq("workspace_id", workspaceId);
  if (error) {
    errors.push(`наблюдатели: ${describe(error)}`);
    return 0;
  }
  const current = new Set(((data ?? []) as Array<{ uid: string }>).map((r) => r.uid));
  const want = new Set(desired);
  const add = [...want].filter((uid) => !current.has(uid));
  const remove = [...current].filter((uid) => !want.has(uid));
  let changed = 0;
  if (add.length) {
    const { error: addError } = await supabaseRows
      .from("rows_desk_observers")
      .upsert(add.map((uid) => ({ workspace_id: workspaceId, uid })), { onConflict: "workspace_id,uid" });
    if (addError) errors.push(`наблюдатели: ${describe(addError)}`);
    else changed += add.length;
  }
  if (remove.length) {
    const { error: removeError } = await supabaseRows
      .from("rows_desk_observers")
      .delete()
      .eq("workspace_id", workspaceId)
      .in("uid", remove);
    if (removeError) errors.push(`наблюдатели: ${describe(removeError)}`);
    else changed += remove.length;
  }
  return changed;
}

/** Стол удалён насовсем (только Owner) — убрать и его запись о правах. */
export async function deletePageAcl(workspaceId: string, pageId: string): Promise<void> {
  const { error } = await supabaseRows.from("rows_page_acl").delete().eq("workspace_id", workspaceId).eq("page_id", pageId);
  if (error) throw new Error(`запись о правах стола не удалилась: ${describe(error)}`);
}

/** Наблюдатель выдан/снят — сразу в копию, не дожидаясь сверки. */
export async function setObserverAcl(workspaceId: string, uid: string, on: boolean): Promise<void> {
  const { error } = on
    ? await supabaseRows.from("rows_desk_observers").upsert([{ workspace_id: workspaceId, uid }], { onConflict: "workspace_id,uid" })
    : await supabaseRows.from("rows_desk_observers").delete().eq("workspace_id", workspaceId).eq("uid", uid);
  if (error) throw new Error(`копия наблюдателей не записалась: ${describe(error)}`);
}

/**
 * Один участник — в копию прав сразу (роль сменили, заявку одобрили): без
 * этого новый технарь до ближайшей сверки руководства не открыл бы свой стол.
 * `member` null — участника больше нет, запись удаляется.
 */
export async function putMemberAcl(workspaceId: string, uid: string, member: WorkspaceMember | null): Promise<void> {
  const row = member ? desiredMemberRows([member])[0] : undefined;
  if (!row) {
    await removeMemberAcl(workspaceId, uid);
    return;
  }
  const put = (value: AclMemberRow) =>
    supabaseRows
      .from("rows_members")
      .upsert([{ workspace_id: workspaceId, ...value, updated_at: Date.now() }], { onConflict: "workspace_id,uid" });
  refreshNickColumnMemory();
  let { error } = await put(nickColumn === false ? withoutNick(row) : row);
  if (error && nickColumn !== false && isSbMissingError(error)) {
    // Столбца ника ещё нет (SQL не вставлен) — роль важнее, пишем без ника.
    markNickColumnMissing();
    ({ error } = await put(withoutNick(row)));
  } else if (!error && nickColumn === null) {
    nickColumn = true;
  }
  if (error && error.code === "42501") {
    // upsert — это INSERT ON CONFLICT, и Postgres проверяет политику ВСТАВКИ
    // и для существующей строки: выданный Owner не вставляет строку с ролью
    // owner, но свою строку править вправе — повторяем обычным update.
    const value = nickColumn === false ? withoutNick(row) : row;
    ({ error } = await supabaseRows
      .from("rows_members")
      .update({ ...value, updated_at: Date.now() })
      .eq("workspace_id", workspaceId)
      .eq("uid", uid));
  }
  if (error) throw new Error(`участник не записан в копию прав: ${describe(error)}`);
}

/**
 * Стол только что создан — запись о его правах сразу, в том же действии:
 * иначе создатель первые секунды видел бы плашку «права не доехали», а
 * набранные строки отклонялись бы. Создатель вправе завести запись своего
 * стола (id с его uid, `generateDeskId`), Owner — любого.
 */
export async function putPageAcl(workspaceId: string, page: WorkspacePage): Promise<void> {
  const put = (value: AclPageRow) =>
    supabaseRows
      .from("rows_page_acl")
      .upsert([{ workspace_id: workspaceId, ...value, updated_at: Date.now() }], {
        onConflict: "workspace_id,page_id",
      });
  const row = desiredPageRow(page);
  refreshKeysColumnMemory();
  let { error } = await put(keysColumn === false ? withoutKeys(row) : row);
  if (error && keysColumn !== false && isSbMissingError(error)) {
    // Столбцов карты столбцов ещё нет (SQL не вставлен) — права важнее, пишем без них.
    markKeysColumnMissing();
    ({ error } = await put(withoutKeys(row)));
  } else if (!error && keysColumn === null) {
    keysColumn = true;
  }
  if (error) throw new Error(`запись о правах стола не создана: ${describe(error)}`);
}

/**
 * Доступ к столу поменяли — сразу в копию прав, тем же действием.
 *
 * Иначе снятый доступ доживал до фоновой сверки (полторы секунды и только в
 * сессии Owner/Тимлида): закрыли вкладку раньше — и человек, которому доступ
 * сняли, продолжал читать и править строки в Supabase. Правка, а не upsert:
 * `created_by`/`os_desk` у вызывающих на руках нет, а upsert затёр бы их.
 * Записи нет — `update` просто ничего не меняет, заведёт её сверка.
 */
export async function patchPageAcl(
  workspaceId: string,
  pageId: string,
  patch: { allowed_uids?: string[]; editable_uids?: string[]; responsible_uid?: string | null }
): Promise<void> {
  const next: Record<string, unknown> = { updated_at: Date.now() };
  if (patch.allowed_uids) next.allowed_uids = sortedUnique(patch.allowed_uids);
  if (patch.editable_uids) next.editable_uids = sortedUnique(patch.editable_uids);
  if (patch.responsible_uid !== undefined) next.responsible_uid = patch.responsible_uid;
  const { error } = await supabaseRows
    .from("rows_page_acl")
    .update(next)
    .eq("workspace_id", workspaceId)
    .eq("page_id", pageId);
  if (error) throw new Error(`права стола не доведены в копию: ${describe(error)}`);
}

/** Участник убран из workspace — сразу из копии: доступ к строкам должен уйти в ту же минуту. */
export async function removeMemberAcl(workspaceId: string, uid: string): Promise<void> {
  const { error } = await supabaseRows.from("rows_members").delete().eq("workspace_id", workspaceId).eq("uid", uid);
  if (error) throw new Error(`участник не убран из копии прав: ${describe(error)}`);
}

// ---------------------------------------------------------------------------
// Состояние последней сверки — для экрана «Строки таблиц».
// ---------------------------------------------------------------------------

export interface AclSyncStatus {
  at: number;
  ok: boolean;
  report: AclSyncReport | null;
  error: string | null;
}

let lastStatus: AclSyncStatus | null = null;
const statusListeners = new Set<() => void>();

export function noteAclSync(status: AclSyncStatus) {
  lastStatus = status;
  statusListeners.forEach((fn) => fn());
}

export function lastAclSync(): AclSyncStatus | null {
  return lastStatus;
}

export function subscribeAclSync(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
}
