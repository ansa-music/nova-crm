import { getDoc, getDocFromServer, getDocsFromServer, query, runTransaction, serverTimestamp, setDoc, updateDoc, where } from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths } from "@/firebase/firestore";
import { supabaseRows } from "@/lib/supabaseRows";
import { addOwnWorkspaceId } from "@/services/authService";
import { primeRowsBackendState } from "@/services/rows/rowsBackend";
import { isSbMissingError } from "@/services/sb/sbCollections";
import { fetchCorePages } from "@/services/coreStore";
import { corePagesOnSupabase } from "@/services/pageService";
import { createManagerOwnedPage } from "@/services/managerPageQuota";
import { fetchTelegramAccessList, setTelegramAccess } from "@/services/telegram/telegramAccess";
import { useWorkspaceStore } from "@/store/workspaceStore";
import {
  isStudioSite,
  STUDIO_NAME,
  STUDIO_PRIMARY_HSL,
  STUDIO_SETTINGS,
  STUDIO_SITE,
  studioSavedFor,
  studioWorkspaceId,
} from "@/config/studio";
import { deskTemplateColumns, type SiteConfig } from "@/types/siteConfig";
import { withDbTimeout } from "@/utils/dbError";
import type { PageColumn, Workspace, WorkspacePage } from "@/types";

/**
 * Воркспейс «NOVA Studio» (просьба Nurba 06.10.2026): создание и обслуживание.
 *
 * Модуль грузится ДИНАМИЧЕСКИ (`import()` в хуках и в одобрении заявки):
 * у других компаний и у всех, кроме администратора платформы, его код не
 * скачивается вовсе. Всё, что здесь пишет, смотрит СОХРАНЁННЫЙ флаг студии
 * (`studioSavedFor`) — черновик Конструктора в чужой компании ничего не
 * запишет.
 *
 * Создание — разовое и идемпотентное, из сессии администратора платформы
 * (`useStudioProvision`). Порядок важен (критика B2 / B0): документ
 * workspace → запись Owner → регистрация в Supabase и `rowsBackend` →
 * `addOwnWorkspaceId` ПОСЛЕДНИМ. Так «студия есть в моём списке» значит
 * «всё сделано», и сбой любого шага повторяется при следующей загрузке.
 */

// ---------------------------------------------------------------------
// Блокировка между вкладками.
// ---------------------------------------------------------------------

/**
 * Одна вкладка браузера за раз (Web Locks, как у Telegram — tgClient).
 * `ifAvailable` — занято другой вкладкой: не ждём, она сделает сама (null).
 * Нет Web Locks — просто выполняем.
 */
export async function runWithStudioLock<T>(name: string, fn: () => Promise<T>, opts: { ifAvailable?: boolean } = {}): Promise<T | null> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks?.request) return fn();
  if (opts.ifAvailable) {
    return locks.request(name, { ifAvailable: true }, (lock) => (lock ? fn() : null)) as Promise<T | null>;
  }
  return locks.request(name, () => fn()) as Promise<T>;
}

// ---------------------------------------------------------------------
// Создание.
// ---------------------------------------------------------------------

type WorkspaceBrief = Pick<Workspace, "id" | "name" | "ownerId"> & { site?: SiteConfig };

export interface StudioProvisionInput {
  uid: string;
  email: string;
  ownerName: string;
  /** Ник из профиля — в запись Owner, чтобы самолечение ника при входе её не переписывало. */
  nickname?: string;
  /** Список workspace из стора (объединённые документы). */
  workspaces: ReadonlyArray<WorkspaceBrief>;
}

export type StudioProvisionResult =
  /** Студия заведена или доведена до конца. `created` — документ создан сейчас. */
  | { kind: "provisioned"; workspaceId: string; created: boolean }
  /** Студия уже есть под другим id (свой workspace с сохранённым флагом студии). */
  | { kind: "exists"; workspaceId: string }
  /** Уже создавалась раньше: Owner её удалил или убрал из списка — не воскрешаем. */
  | { kind: "deleted" }
  /** Уже создавалась раньше и на месте. */
  | { kind: "done" }
  /** Документ с этим id принадлежит другому (не бывает, но писать нельзя). */
  | { kind: "foreign" }
  /** Регистрация в Supabase не прошла — повтор при следующей загрузке. */
  | { kind: "retry"; reason: string };

/** Пресет — чистые данные: без undefined (ignoreUndefinedProperties выключен) и свежими объектами. */
function plainSettings(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(STUDIO_SETTINGS)) as Record<string, unknown>;
}

function rpcReason(error: unknown): string {
  const e = (error ?? {}) as { code?: unknown; message?: unknown };
  const code = typeof e.code === "string" && e.code ? e.code : "";
  const message = typeof e.message === "string" ? e.message : String(error);
  return code ? `${code}: ${message}` : message;
}

/** Отметка «создание сделано» в профиле — для других устройств администратора. */
async function markProvisionedOnServer(uid: string) {
  await setDoc(paths.user(uid), { studioProvisionedAt: Date.now() }, { merge: true });
}

/**
 * Свои workspace для проверки «студия уже есть». Список из стора дополняется
 * документами id, которые есть в профиле, но не в списке (список мог прийти
 * из кэша): иначе рядом со студией под другим id завелась бы вторая.
 */
async function ownedWorkspaces(uid: string, listed: ReadonlyArray<WorkspaceBrief>, profileIds: string[], skipId: string): Promise<WorkspaceBrief[]> {
  const known = new Set(listed.map((w) => w.id));
  const extra = profileIds.filter((id) => id !== skipId && !known.has(id));
  const fetched = await Promise.allSettled(extra.map((id) => getDoc(paths.workspace(id))));
  const more: WorkspaceBrief[] = [];
  for (const result of fetched) {
    if (result.status !== "fulfilled" || !result.value.exists()) continue;
    more.push({ id: result.value.id, ...(result.value.data() as Omit<WorkspaceBrief, "id">) });
  }
  return [...listed, ...more].filter((w) => w.id !== skipId && w.ownerId === uid);
}

/**
 * Завести «NOVA Studio» для администратора платформы — идемпотентно.
 * Бросает только на настоящей ошибке Firestore (permission-denied — хук
 * ставит отметку и больше не пробует на этом устройстве).
 */
export async function provisionStudioWorkspace(input: StudioProvisionInput): Promise<StudioProvisionResult> {
  if (!db) throw new Error("Firebase не настроен");
  const firestore = db;
  const { uid } = input;
  const id = studioWorkspaceId(uid);

  // 0. Профиль с сервера: создавалась ли уже студия и что в моём списке.
  const userSnap = await getDocFromServer(paths.user(uid));
  const userData = (userSnap.exists() ? userSnap.data() : {}) as { workspaceIds?: unknown; studioProvisionedAt?: unknown };
  const profileIds = Array.isArray(userData.workspaceIds) ? userData.workspaceIds.filter((v): v is string => typeof v === "string") : [];
  if (typeof userData.studioProvisionedAt === "number") {
    // Создание закончено раньше (отметка ставится последним шагом). Нет в
    // списке — Owner удалил или убрал её: не воскрешаем. Есть — делать нечего.
    return profileIds.includes(id) ? { kind: "done" } : { kind: "deleted" };
  }

  // Пока студии с детерминированным id в списке нет — нет ли уже своей
  // студии под другим id (сохранённый флаг `site.profile`). Похожее имя
  // ничего не значит: так может называться главная компания (ревью C1/C2) —
  // чужие настройки не трогаем, просто заводим отдельный workspace.
  if (!input.workspaces.some((w) => w.id === id)) {
    const owned = await ownedWorkspaces(uid, input.workspaces, profileIds, id);
    const studio = owned.find((w) => isStudioSite(w.site));
    if (studio) {
      await markProvisionedOnServer(uid);
      return { kind: "exists", workspaceId: studio.id };
    }
  }

  // (a) Документ workspace: создать, если нет; чужой — стоп; свой — не трогать.
  const ref = paths.workspace(id);
  const tx = await withDbTimeout(
    runTransaction(firestore, async (t) => {
      const snap = await t.get(ref);
      if (!snap.exists()) {
        t.set(ref, {
          id,
          name: STUDIO_NAME,
          icon: "Rocket",
          color: STUDIO_PRIMARY_HSL,
          ownerId: uid,
          createdAt: serverTimestamp(),
          ...plainSettings(),
        });
        return { state: "created" as const, rowsBackend: undefined as string | undefined };
      }
      const data = snap.data() as Partial<Workspace>;
      if (data.ownerId !== uid) return { state: "foreign" as const, rowsBackend: undefined };
      return { state: "mine" as const, rowsBackend: data.rowsBackend };
    }),
    "Создание NOVA Studio"
  );
  if (tx.state === "foreign") return { kind: "foreign" };

  // (b) Запись Owner — целиком (как registerCompany), если её нет или она не
  // «Owner, active»: пульс присутствия мог оставить документ без роли (I8).
  // Плюс ник профиля: без него самолечение ника при входе дописывало его
  // отдельной записью.
  const memberRef = paths.member(id, uid);
  const memberSnap = await getDoc(memberRef);
  const member = (memberSnap.exists() ? memberSnap.data() : null) as { role?: string; status?: string } | null;
  if (!(member?.role === "owner" && member.status === "active")) {
    const now = Date.now();
    await setDoc(
      memberRef,
      {
        uid,
        email: input.email,
        name: input.ownerName,
        ...(input.nickname ? { nickname: input.nickname } : {}),
        role: "owner",
        status: "active",
        invitedAt: now,
        invitedBy: uid,
        joinedAt: now,
      },
      { merge: true }
    );
  }

  // (c) Регистрация в Supabase (повтор отвечает `already`), потом хранилище строк.
  try {
    const { data, error } = await supabaseRows.rpc("rows_register_company", { p_workspace: id, p_code: null, p_name: STUDIO_NAME });
    if (error) return { kind: "retry", reason: rpcReason(error) };
    const status = ((data ?? {}) as { status?: unknown }).status;
    if (status !== "registered" && status !== "already") return { kind: "retry", reason: `rows_register_company: ${String(status)}` };
  } catch (error) {
    return { kind: "retry", reason: isSbMissingError(error) ? `SQL: ${rpcReason(error)}` : rpcReason(error) };
  }
  if (tx.rowsBackend !== "supabase") await updateDoc(ref, { rowsBackend: "supabase" });
  primeRowsBackendState(id, "supabase", false);

  // (d) В свой список — ПОСЛЕДНИМ: «студия в списке» = «всё сделано».
  await addOwnWorkspaceId(uid, id);

  // (e) Отметка для других устройств (на этом — localStorage ставит хук).
  await markProvisionedOnServer(uid);
  return { kind: "provisioned", workspaceId: id, created: tx.state === "created" };
}

// ---------------------------------------------------------------------
// Свой стол менеджера.
// ---------------------------------------------------------------------

/** «Стол {ник}» — в пределах 40 знаков названия стола. */
export function studioDeskName(nick: string): string {
  const clean = nick.replace(/\s+/g, " ").trim() || "менеджера";
  return `Стол ${clean}`.slice(0, 40).trim();
}

/**
 * Столбцы стола из шаблона Конструктора этой студии, иначе — шаблон пресета.
 * Своё поле, которого нет в `customFields` компании, — обычный текст (как в
 * CreatePageDialog): иначе выпадашка была бы пустой.
 */
export function studioDeskColumns(site: SiteConfig | null | undefined, customFieldIds: ReadonlySet<string>): Omit<PageColumn, "id">[] {
  const columns = deskTemplateColumns(site) ?? deskTemplateColumns(STUDIO_SITE) ?? [];
  return columns.map((c) =>
    c.type === "custom" && !(c.customFieldId && customFieldIds.has(c.customFieldId))
      ? { key: c.key, label: c.label, type: "text", width: c.width, order: c.order }
      : c
  );
}

/**
 * Свои столы человека (активные и неактуальные) — свежим чтением, мимо
 * снимка вкладки: снимок мог прийти из кэша, а вторая вкладка или другое
 * устройство — успеть завести стол. null — прочитать не вышло (не создаём).
 */
async function fetchOwnDesksFresh(workspaceId: string, uid: string): Promise<WorkspacePage[] | null> {
  if (corePagesOnSupabase(workspaceId)) {
    const pages = await fetchCorePages(workspaceId);
    return pages ? pages.filter((p) => p.responsibleUserId === uid) : null;
  }
  const snap = await getDocsFromServer(query(paths.pages(workspaceId), where("responsibleUserId", "==", uid)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as WorkspacePage);
}

function isQuietDeskError(error: unknown): boolean {
  const e = (error ?? {}) as { code?: unknown; message?: unknown };
  if (e.code === "42501" || e.code === "permission-denied") return true;
  return typeof e.message === "string" && /лимит/i.test(e.message);
}

export interface StudioDeskInput {
  workspaceId: string;
  uid: string;
  /** Ник / имя человека — для «Стол {ник}». */
  nick: string;
  order: number;
}

/**
 * Завести менеджеру его единственный стол (сессия самого менеджера). Квоту
 * «один стол» держит сервер (claim в Firestore, core_write в Supabase) —
 * её отказ тихий. null — стол уже есть, не студия или отказ квоты.
 */
export async function ensureStudioOwnDesk(input: StudioDeskInput): Promise<WorkspacePage | null> {
  if (!db || !studioSavedFor(input.workspaceId)) return null;
  const ws = useWorkspaceStore.getState().workspaces.find((w) => w.id === input.workspaceId);
  const own = await fetchOwnDesksFresh(input.workspaceId, input.uid);
  if (own === null || own.length > 0) return null;
  try {
    return await createManagerOwnedPage({
      workspaceId: input.workspaceId,
      name: studioDeskName(input.nick),
      icon: "Star",
      color: STUDIO_PRIMARY_HSL,
      columns: studioDeskColumns(ws?.site, new Set((ws?.customFields ?? []).map((f) => f.id))),
      managerUid: input.uid,
      order: input.order,
    });
  } catch (error) {
    if (isQuietDeskError(error)) {
      console.info("[studio] стол менеджера не заведён (квота / права)", error);
      return null;
    }
    throw error;
  }
}

// ---------------------------------------------------------------------
// Общий Telegram.
// ---------------------------------------------------------------------

/** tg_set_access принимает не больше 200 человек. */
const TG_ACCESS_MAX = 200;

/** Нет SQL, нет прав (не Owner), нет раздела — «не выполнено», а не ошибка. */
function isQuietTgError(error: unknown): boolean {
  if (isSbMissingError(error)) return true;
  const e = (error ?? {}) as { code?: unknown; message?: unknown };
  if (e.code === "42501") return true;
  // telegramAccess переводит «SQL не накатан» в текст без кода.
  return typeof e.message === "string" && /нет раздела Telegram/i.test(e.message);
}

/** Подключён ли общий аккаунт на сервере. null — не узнать (нет SQL / прав / сбой). */
async function sharedAccountConnected(workspaceId: string): Promise<boolean | null> {
  try {
    const { data, error } = await supabaseRows.rpc("tg_account_status", { p_workspace: workspaceId });
    if (error) return null;
    return ((data ?? {}) as { connected?: unknown }).connected === true;
  } catch {
    return null;
  }
}

/** Чтение-плюс-запись списка — по очереди в вкладке (и между вкладками через Web Lock). */
let tgQueue: Promise<unknown> = Promise.resolve();

/**
 * Доступ к общему Telegram у всех участников студии — ТОЛЬКО добавить
 * (критика B1/B2): `tg_set_access` заменяет список целиком, поэтому пишем
 * объединение с тем, что уже есть, и никого не убираем; `devices_prune` не
 * зовём. Только когда общий аккаунт уже подключён на сервере (I12): иначе
 * менеджер мог бы первым подключить свой личный Telegram.
 *
 * null — не выполнено (не студия, аккаунт не подключён или не узнать, нет
 * SQL, нет прав); бросает только на настоящей ошибке.
 */
export async function ensureStudioTelegramAccess(workspaceId: string, memberUids: string[]): Promise<{ added: string[] } | null> {
  if (!studioSavedFor(workspaceId)) return null;
  const wanted = [...new Set(memberUids.filter((uid) => typeof uid === "string" && uid))];
  const run = async (): Promise<{ added: string[] } | null> => {
    if (!(await sharedAccountConnected(workspaceId))) return null;
    let current: string[];
    try {
      current = await fetchTelegramAccessList(workspaceId);
    } catch (error) {
      if (isQuietTgError(error)) return null;
      throw error;
    }
    const have = new Set(current);
    const missing = wanted.filter((uid) => !have.has(uid));
    if (missing.length === 0) return { added: [] };
    const next = [...current, ...missing];
    if (next.length > TG_ACCESS_MAX) return null;
    let result: string[];
    try {
      result = await setTelegramAccess(workspaceId, next);
    } catch (error) {
      if (isQuietTgError(error)) return null;
      throw error;
    }
    // База берёт только участников (копия прав могла ещё не доехать) —
    // «добавлены» те, кто в итоговом списке. Ответ не разобрался — как просили.
    const granted = new Set(result);
    return { added: result.length > 0 ? missing.filter((uid) => granted.has(uid)) : missing };
  };
  const queued = tgQueue.then(() => runWithStudioLock(`nova-studio-tg:${workspaceId}`, run));
  tgQueue = queued.catch(() => undefined);
  return queued;
}
