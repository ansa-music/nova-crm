import { useEffect, useSyncExternalStore } from "react";
import { supabaseRows } from "@/lib/supabaseRows";
import { isSbMissingError } from "@/services/sb/sbCollections";
import { listenTopic, ringTopic } from "@/services/sb/topicDoorbell";
import { sendNotification } from "@/services/notificationService";
import { removeRowFiles, rowFilePublicUrl, uploadRowFile } from "@/services/storageClient";

/**
 * «Промты» (27.09.2026, SQL 20261034_prompts.sql).
 *
 * Личные промты видит только автор; другой участник видит лишь название и
 * автора и может попросить доступ — автор открывает или отклоняет. Общие видят
 * все, пишут выбранные Owner люди («писатели») и сам Owner. Всё закрыто в базе:
 * таблицы без политик, наружу — функции `prompt_*`.
 *
 * Состояние одно на вкладку (модуль): одна выборка `prompt_list` при открытии,
 * перечитка при возврате на вкладку (не чаще раза в 2 минуты) и по звонку
 * `nova:{ws}:prompts` после чужой правки общего промта или решения по доступу.
 */

export type PromptKind = "personal" | "shared";

export interface Prompt {
  id: string;
  kind: PromptKind;
  authorUid: string;
  title: string;
  purpose: string;
  body: string;
  photoUrl: string | null;
  photoPath: string | null;
  createdAt: number;
  updatedAt: number;
  /** Чужой личный, открытый мне. */
  granted: boolean;
  /** Только автору личного: кому открыт. */
  access: string[];
}

export interface PromptStub {
  id: string;
  title: string;
  authorUid: string;
  request: "pending" | "approved" | "rejected" | null;
}

export interface PromptRequest {
  promptId: string;
  uid: string;
  at: number;
}

export interface PromptsData {
  isOwner: boolean;
  canWriteShared: boolean;
  /** Только Owner. */
  writers: string[];
  prompts: Prompt[];
  stubs: PromptStub[];
  requests: PromptRequest[];
}

export type PromptsStatus = "idle" | "loading" | "ready" | "missing" | "error";

export interface PromptsSnapshot {
  status: PromptsStatus;
  data: PromptsData | null;
}

const IDLE: PromptsSnapshot = { status: "idle", data: null };
const STALE_MS = 2 * 60_000;
const topicOf = (ws: string) => `nova:${ws}:prompts`;

interface Entry {
  snap: PromptsSnapshot;
  loadedAt: number;
  inflight: Promise<void> | null;
  users: number;
  stopRing: (() => void) | null;
}

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();

function entryOf(ws: string): Entry {
  let entry = entries.get(ws);
  if (!entry) {
    entry = { snap: IDLE, loadedAt: 0, inflight: null, users: 0, stopRing: null };
    entries.set(ws, entry);
  }
  return entry;
}

function emit() {
  for (const listener of [...listeners]) listener();
}

function setSnap(ws: string, snap: PromptsSnapshot) {
  entryOf(ws).snap = snap;
  emit();
}

function patchData(ws: string, fn: (data: PromptsData) => PromptsData) {
  const snap = entryOf(ws).snap;
  if (snap.data) setSnap(ws, { ...snap, data: fn(snap.data) });
}

function asObject(data: unknown): Record<string, unknown> {
  if (typeof data === "string") {
    try {
      return JSON.parse(data) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return data && typeof data === "object" ? (data as Record<string, unknown>) : {};
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export function parsePrompt(v: unknown): Prompt | null {
  const o = asObject(v);
  if (typeof o.id !== "string" || (o.kind !== "personal" && o.kind !== "shared")) return null;
  return {
    id: o.id,
    kind: o.kind,
    authorUid: str(o.authorUid),
    title: str(o.title),
    purpose: str(o.purpose),
    body: str(o.body),
    photoUrl: typeof o.photoUrl === "string" && o.photoUrl ? o.photoUrl : null,
    photoPath: typeof o.photoPath === "string" && o.photoPath ? o.photoPath : null,
    createdAt: num(o.createdAt),
    updatedAt: num(o.updatedAt),
    granted: o.granted === true,
    access: strings(o.access),
  };
}

export function parsePromptsData(data: unknown): PromptsData {
  const o = asObject(data);
  const prompts = (Array.isArray(o.prompts) ? o.prompts : []).map(parsePrompt).filter((p): p is Prompt => Boolean(p));
  const stubs: PromptStub[] = [];
  for (const item of Array.isArray(o.stubs) ? o.stubs : []) {
    const s = asObject(item);
    if (typeof s.id !== "string") continue;
    const request = s.request === "pending" || s.request === "approved" || s.request === "rejected" ? s.request : null;
    stubs.push({ id: s.id, title: str(s.title), authorUid: str(s.authorUid), request });
  }
  const requests: PromptRequest[] = [];
  for (const item of Array.isArray(o.requests) ? o.requests : []) {
    const r = asObject(item);
    if (typeof r.promptId !== "string" || typeof r.uid !== "string") continue;
    requests.push({ promptId: r.promptId, uid: r.uid, at: num(r.at) });
  }
  return {
    isOwner: o.isOwner === true,
    canWriteShared: o.canWriteShared === true,
    writers: strings(o.writers),
    prompts,
    stubs,
    requests,
  };
}

async function load(ws: string): Promise<void> {
  const entry = entryOf(ws);
  if (entry.inflight) return entry.inflight;
  if (entry.snap.status === "idle") setSnap(ws, { ...entry.snap, status: "loading" });
  entry.inflight = (async () => {
    try {
      const { data, error } = await supabaseRows.rpc("prompt_list", { p_workspace: ws });
      if (error) {
        const missing = isSbMissingError(error);
        if (!missing) console.warn("[prompts] read failed", error);
        setSnap(ws, entry.snap.data ? entry.snap : { status: missing ? "missing" : "error", data: null });
        return;
      }
      entry.loadedAt = Date.now();
      setSnap(ws, { status: "ready", data: parsePromptsData(data) });
    } catch (error) {
      console.warn("[prompts] read failed", error);
      if (!entry.snap.data) setSnap(ws, { status: "error", data: null });
    } finally {
      entry.inflight = null;
    }
  })();
  return entry.inflight;
}

export function refreshPrompts(ws: string) {
  return load(ws);
}

let visibilityBound = false;
function bindVisibility() {
  if (visibilityBound || typeof document === "undefined") return;
  visibilityBound = true;
  const onBack = () => {
    if (document.visibilityState !== "visible") return;
    for (const [ws, entry] of entries) {
      if (entry.users > 0 && Date.now() - entry.loadedAt > STALE_MS) void load(ws);
    }
  };
  document.addEventListener("visibilitychange", onBack);
  window.addEventListener("focus", onBack);
}

function retain(ws: string) {
  const entry = entryOf(ws);
  entry.users += 1;
  if (!entry.stopRing) entry.stopRing = listenTopic(topicOf(ws), () => void load(ws));
  bindVisibility();
  if (entry.snap.status === "idle" || entry.snap.status === "error" || Date.now() - entry.loadedAt > STALE_MS) void load(ws);
  return () => {
    entry.users -= 1;
    if (entry.users <= 0) {
      entry.users = 0;
      entry.stopRing?.();
      entry.stopRing = null;
    }
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePrompts(ws: string | null | undefined): PromptsSnapshot {
  useEffect(() => {
    if (!ws) return;
    return retain(ws);
  }, [ws]);
  return useSyncExternalStore(subscribe, () => (ws ? entryOf(ws).snap : IDLE));
}

// ---------------------------------------------------------------------
// Действия.
// ---------------------------------------------------------------------

function promptErrorText(error: { code?: string; message?: string }, fallback: string): string {
  const msg = error.message ?? "";
  if (isSbMissingError(error)) return "Промты ещё не включены в базе — Owner должен обновить SQL.";
  if (msg.includes("suspended")) return "Доступ компании приостановлен.";
  if (msg.includes("not a shared writer")) return "Писать общие промты может только тот, кому Owner разрешил.";
  if (msg.includes("not the author")) return "Это не ваш промт.";
  if (msg.includes("title required")) return "Впишите название.";
  if (msg.includes("body required")) return "Впишите сам промт.";
  if (msg.includes("too long")) return "Слишком длинно: название до 120, «для чего» до 300, промт до 20 000 знаков.";
  if (msg.includes("too many prompts")) return "У вас уже 500 промтов — удалите ненужные.";
  if (msg.includes("prompt deleted") || msg.includes("prompt not found")) return "Промт уже удалён.";
  if (msg.includes("only owner")) return "Это может только Owner.";
  if (error.code === "42501") return "Нет права.";
  return `${fallback}${error.code ? ` (${error.code})` : ""}.`;
}

export function newPromptId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID().replace(/-/g, "");
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

export interface PromptDraft {
  id: string | null;
  kind: PromptKind;
  title: string;
  purpose: string;
  body: string;
  /** Как должно быть после сохранения (null — без фото). */
  photoUrl: string | null;
  photoPath: string | null;
}

/**
 * Создать или сохранить промт. Прежнее фото, которое заменили или убрали,
 * стирается после записи; новое, если запись не прошла, — тоже.
 */
export async function savePrompt(ws: string, draft: PromptDraft, previousPhotoPath: string | null): Promise<Prompt> {
  const id = draft.id ?? newPromptId();
  const { data, error } = await supabaseRows.rpc("prompt_save", {
    p_workspace: ws,
    p_id: id,
    p_kind: draft.kind,
    p_title: draft.title,
    p_purpose: draft.purpose,
    p_body: draft.body,
    p_photo_url: draft.photoUrl,
    p_photo_path: draft.photoPath,
  });
  if (error) {
    if (draft.photoPath && draft.photoPath !== previousPhotoPath) void removeRowFiles([draft.photoPath]);
    throw new Error(promptErrorText(error, "Не удалось сохранить промт"));
  }
  const saved = parsePrompt(data);
  if (previousPhotoPath && previousPhotoPath !== draft.photoPath) void removeRowFiles([previousPhotoPath]);
  if (saved) {
    patchData(ws, (d) => {
      const prev = d.prompts.find((p) => p.id === saved.id);
      const next = { ...saved, access: prev?.access ?? [], granted: false };
      return { ...d, prompts: [next, ...d.prompts.filter((p) => p.id !== saved.id)] };
    });
  }
  if (draft.kind === "shared") ringTopic(topicOf(ws));
  if (!saved) await load(ws);
  return saved ?? (entryOf(ws).snap.data?.prompts.find((p) => p.id === id) as Prompt);
}

export async function deletePrompt(ws: string, prompt: Prompt) {
  const before = entryOf(ws).snap.data;
  patchData(ws, (d) => ({ ...d, prompts: d.prompts.filter((p) => p.id !== prompt.id), requests: d.requests.filter((r) => r.promptId !== prompt.id) }));
  const { data, error } = await supabaseRows.rpc("prompt_delete", { p_workspace: ws, p_id: prompt.id });
  if (error) {
    if (before) setSnap(ws, { status: "ready", data: before });
    throw new Error(promptErrorText(error, "Не удалось удалить промт"));
  }
  const path = asObject(data).photoPath;
  if (typeof path === "string" && path) void removeRowFiles([path]);
  if (prompt.kind === "shared" || prompt.access.length) ringTopic(topicOf(ws));
}

interface Sender {
  uid: string;
  name: string;
}

export async function requestPromptAccess(ws: string, stub: PromptStub, sender: Sender) {
  patchData(ws, (d) => ({ ...d, stubs: d.stubs.map((s) => (s.id === stub.id ? { ...s, request: "pending" } : s)) }));
  const { data, error } = await supabaseRows.rpc("prompt_request", { p_workspace: ws, p_id: stub.id });
  if (error) {
    patchData(ws, (d) => ({ ...d, stubs: d.stubs.map((s) => (s.id === stub.id ? { ...s, request: stub.request } : s)) }));
    throw new Error(promptErrorText(error, "Не удалось отправить запрос"));
  }
  const o = asObject(data);
  if (o.already === true) {
    await load(ws);
    return;
  }
  ringTopic(topicOf(ws));
  const author = str(o.author);
  if (!author) return;
  await sendNotification(
    {
      workspaceId: ws,
      title: "Просят доступ к промту",
      body: `${sender.name} просит открыть «${stub.title}».`,
      priority: "normal",
      fromUid: sender.uid,
      fromName: sender.name,
      target: "selected",
      selectedUids: [author],
      href: "/prompts",
      kind: "prompt",
    },
    [author]
  ).catch((err) => console.warn("[prompts] notify failed", err));
}

export async function resolvePromptRequest(ws: string, request: PromptRequest, approve: boolean, sender: Sender) {
  const before = entryOf(ws).snap.data;
  patchData(ws, (d) => ({
    ...d,
    requests: d.requests.filter((r) => !(r.promptId === request.promptId && r.uid === request.uid)),
    prompts: approve
      ? d.prompts.map((p) => (p.id === request.promptId && !p.access.includes(request.uid) ? { ...p, access: [...p.access, request.uid] } : p))
      : d.prompts,
  }));
  const { data, error } = await supabaseRows.rpc("prompt_resolve", {
    p_workspace: ws,
    p_id: request.promptId,
    p_uid: request.uid,
    p_approve: approve,
  });
  if (error) {
    if (before) setSnap(ws, { status: "ready", data: before });
    throw new Error(promptErrorText(error, "Не удалось ответить на запрос"));
  }
  ringTopic(topicOf(ws));
  const title = str(asObject(data).title);
  await sendNotification(
    {
      workspaceId: ws,
      title: approve ? "Доступ к промту открыт" : "В доступе к промту отказали",
      body: approve ? `«${title}» теперь во вкладке «Общие» → «Открытые вам».` : `«${title}» — автор не открыл доступ.`,
      priority: "normal",
      fromUid: sender.uid,
      fromName: sender.name,
      target: "selected",
      selectedUids: [request.uid],
      href: "/prompts?v=shared",
      kind: "prompt",
    },
    [request.uid]
  ).catch((err) => console.warn("[prompts] notify failed", err));
}

export async function revokePromptAccess(ws: string, promptId: string, uid: string) {
  const before = entryOf(ws).snap.data;
  patchData(ws, (d) => ({ ...d, prompts: d.prompts.map((p) => (p.id === promptId ? { ...p, access: p.access.filter((u) => u !== uid) } : p)) }));
  const { error } = await supabaseRows.rpc("prompt_revoke", { p_workspace: ws, p_id: promptId, p_uid: uid });
  if (error) {
    if (before) setSnap(ws, { status: "ready", data: before });
    throw new Error(promptErrorText(error, "Не удалось снять доступ"));
  }
  ringTopic(topicOf(ws));
}

export async function setPromptWriters(ws: string, uids: string[]) {
  const { error } = await supabaseRows.rpc("prompt_set_writers", { p_workspace: ws, p_uids: uids });
  if (error) throw new Error(promptErrorText(error, "Не удалось сохранить"));
  await load(ws);
  ringTopic(topicOf(ws));
}

// ---------------------------------------------------------------------
// Фото результата: одно на промт, уменьшается до 1280 px перед загрузкой.
// ---------------------------------------------------------------------

export const PROMPT_PHOTO_MAX_INPUT = 15 * 1024 * 1024;
const PHOTO_MAX_SIDE = 1280;
const ALLOWED = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

async function downscale(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Не удалось открыть картинку"));
      el.src = url;
    });
    const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    if (scale === 1 && file.size <= 400 * 1024 && file.type !== "image/png") return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.84));
    return blob && blob.size < file.size ? blob : file;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Загрузить фото результата в свою папку; ссылка и путь — для `savePrompt`. */
export async function uploadPromptPhoto(ws: string, uid: string, file: File): Promise<{ url: string; path: string }> {
  if (!ALLOWED.has(file.type)) throw new Error("Можно только jpeg, png или webp.");
  if (file.size > PROMPT_PHOTO_MAX_INPUT) throw new Error("Картинка больше 15 МБ.");
  const blob = await downscale(file);
  const type = blob.type || file.type;
  const ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
  const path = `${ws}/prompts/${uid}/${newPromptId()}.${ext}`;
  const { error } = await uploadRowFile(path, blob, { cacheControl: "31536000", contentType: type });
  if (error) throw new Error(`Фото не загрузилось: ${error.message}`);
  return { url: rowFilePublicUrl(path), path };
}

/** Убрать загруженное, но не сохранённое фото (форму закрыли). */
export function discardPromptPhoto(path: string | null) {
  if (path) void removeRowFiles([path]);
}

// ---------------------------------------------------------------------

/** Скопировать текст: буфер обмена, иначе — выделенное поле и `execCommand`. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // ниже — запасной путь
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-1000px";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Поиск по названию, «для чего» и тексту (текст — только открытых). */
export function matchesPrompt(p: { title: string; purpose?: string; body?: string }, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [p.title, p.purpose ?? "", p.body ?? ""].some((s) => s.toLowerCase().includes(q));
}
