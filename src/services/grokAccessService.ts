import {
  arrayUnion,
  deleteDoc,
  onSnapshot,
  query,
  setDoc,
  where,
  writeBatch,
  type FirestoreError,
} from "firebase/firestore";
import { db } from "@/firebase/firebase";
import { paths, withErrorReporting } from "@/firebase/firestore";
import { sendNotification } from "@/services/notificationService";
import {
  grokAccessRequestId,
  grokAppProviderLabel,
  grokSectionOfProvider,
  GROK_ACCESS_DOC_ID,
  GROK_SECTION_PROVIDERS,
  maskedEmail,
  type GrokAccessRequest,
  type GrokAccessSettings,
  type GrokAccessStub,
  type GrokAppAccount,
  type GrokAppProvider,
  type GrokAppSectionId,
} from "@/types";

// ---------------------------------------------------------------------------
// Кто управляет разделом (см. types/grokAccess.ts)
// ---------------------------------------------------------------------------

export function subscribeGrokAccessSettings(
  workspaceId: string,
  onData: (settings: GrokAccessSettings | null) => void,
  onError?: (error: FirestoreError) => void
) {
  if (!db) {
    onData(null);
    return () => {};
  }
  return onSnapshot(
    paths.grokSettings(workspaceId, GROK_ACCESS_DOC_ID),
    (snapshot) => {
      const data = snapshot.exists() ? (snapshot.data() as GrokAccessSettings) : null;
      onData(data ? { ...data, managers: data.managers ?? {} } : null);
    },
    withErrorReporting(onError)
  );
}

/** Провайдеры, которыми управляет человек. Owner — всеми. */
export function managedProvidersOf(settings: GrokAccessSettings | null, uid: string): GrokAppProvider[] {
  const managers = settings?.managers ?? {};
  return (Object.keys(managers) as GrokAppProvider[]).filter((provider) => managers[provider]?.includes(uid));
}

/**
 * Назначить, кто управляет разделом. Только Owner (правило). Массив при merge
 * — лист, он заменяется целиком; ключи других разделов не трогаются.
 */
export async function saveGrokSectionManagers(input: {
  workspaceId: string;
  section: GrokAppSectionId;
  uids: string[];
  actorUid: string;
}) {
  if (!db) throw new Error("Firebase не настроен");
  const managers: Record<string, string[]> = {};
  for (const provider of GROK_SECTION_PROVIDERS[input.section]) managers[provider] = input.uids;
  await setDoc(
    paths.grokSettings(input.workspaceId, GROK_ACCESS_DOC_ID),
    { workspaceId: input.workspaceId, managers, updatedAt: Date.now(), updatedBy: input.actorUid },
    { merge: true }
  );
}

// ---------------------------------------------------------------------------
// Витрина закрытых аккаунтов
// ---------------------------------------------------------------------------

export function subscribeGrokAccessStubs(
  workspaceId: string,
  onData: (stubs: GrokAccessStub[]) => void,
  onError?: (error: FirestoreError) => void
) {
  if (!db) {
    onData([]);
    return () => {};
  }
  return onSnapshot(
    paths.grokAccessStubs(workspaceId),
    (snapshot) => onData(snapshot.docs.map((d) => ({ ...(d.data() as GrokAccessStub), id: d.id }))),
    withErrorReporting(onError)
  );
}

export function grokStubTitle(account: GrokAppAccount): string {
  return account.nickname?.trim() || maskedEmail(account.email);
}

function stubData(account: GrokAppAccount) {
  return {
    workspaceId: account.workspaceId,
    provider: account.provider,
    providerOther: account.provider === "other" ? account.providerOther?.trim() ?? "" : "",
    title: grokStubTitle(account),
  };
}

/**
 * Сверить витрину с настоящими аккаунтами. Запускает сессия того, кто
 * управляет разделом (или Owner): только она видит закрытые аккаунты
 * целиком. Так витрина сама заводится для уже закрытых аккаунтов, следует за
 * переименованием и чистится, когда аккаунт открыли всем или удалили —
 * удалить аккаунт может и технарь, а витрину он трогать не вправе.
 *
 * `accounts` обязан быть ПОЛНЫМ списком аккаунтов этих провайдеров, иначе
 * сверка удалит витрину живого аккаунта: вызывать только после того, как все
 * запросы пришли с сервера.
 */
export async function syncGrokAccessStubs(input: {
  workspaceId: string;
  accounts: GrokAppAccount[];
  stubs: GrokAccessStub[];
  /** Чьи витрины сверяем; `"all"` — Owner. */
  providers: GrokAppProvider[] | "all";
}): Promise<number> {
  if (!db) return 0;
  const inScope = (provider: GrokAppProvider) => input.providers === "all" || input.providers.includes(provider);
  const desired = new Map(
    input.accounts
      .filter((a) => a.restricted === true && inScope(a.provider))
      .map((a) => [a.id, stubData({ ...a, workspaceId: input.workspaceId })] as const)
  );
  const batch = writeBatch(db);
  let writes = 0;
  for (const [id, data] of desired) {
    const current = input.stubs.find((s) => s.id === id);
    if (current && current.provider === data.provider && current.providerOther === data.providerOther && current.title === data.title) {
      continue;
    }
    // Чужая карточка (провайдер, которым я не управляю) — переписать её мне
    // не дадут, а отказ одной записи уронил бы всю пачку, и сверка крутилась
    // бы по кругу. Её поправит тот, кто управляет её разделом.
    if (current && !inScope(current.provider)) continue;
    batch.set(paths.grokAccessStub(input.workspaceId, id), { ...data, updatedAt: Date.now() });
    writes += 1;
  }
  for (const stub of input.stubs) {
    if (!inScope(stub.provider) || desired.has(stub.id)) continue;
    batch.delete(paths.grokAccessStub(input.workspaceId, stub.id));
    writes += 1;
  }
  if (writes > 0) await batch.commit();
  return writes;
}

// ---------------------------------------------------------------------------
// Открыть / закрыть аккаунт — вместе с витриной
// ---------------------------------------------------------------------------

/**
 * Открыть аккаунт списку людей. Пустой список = аккаунт снова открыт всем:
 * «закрыт и никому не открыт» — состояние, из которого его никто, кроме
 * управляющих, уже не увидит. Витрина пишется той же пачкой: закрыли — у
 * технарей сразу появилась карточка «запросить доступ», открыли — пропала.
 */
export async function setGrokAppAccess(input: {
  workspaceId: string;
  account: GrokAppAccount;
  allowedUids: string[];
  /** Есть ли карточка на витрине: удалять несуществующую незачем. */
  stubExists: boolean;
  actorUid: string;
  actorName: string;
}) {
  if (!db) throw new Error("Firebase не настроен");
  const restricted = input.allowedUids.length > 0;
  const batch = writeBatch(db);
  batch.set(
    paths.grokAppAccount(input.workspaceId, input.account.id),
    {
      restricted,
      allowedUids: input.allowedUids,
      updatedByUid: input.actorUid,
      updatedByName: input.actorName,
      updatedAt: Date.now(),
    },
    { merge: true }
  );
  const stub = paths.grokAccessStub(input.workspaceId, input.account.id);
  if (restricted) {
    batch.set(stub, { ...stubData({ ...input.account, workspaceId: input.workspaceId }), updatedAt: Date.now() });
  } else if (input.stubExists) {
    batch.delete(stub);
  }
  await batch.commit();
}

/** Убрать запросы к аккаунтам, которых больше нет (удалили без чистки). */
export async function deleteGrokAccessRequests(workspaceId: string, requestIds: string[]) {
  if (!db || requestIds.length === 0) return;
  const batch = writeBatch(db);
  for (const id of requestIds) batch.delete(paths.grokAccessRequest(workspaceId, id));
  await batch.commit();
}

// ---------------------------------------------------------------------------
// Запросы на доступ
// ---------------------------------------------------------------------------

function mapRequests(docs: { id: string; data: () => unknown }[]): GrokAccessRequest[] {
  return docs.map((d) => ({ ...(d.data() as GrokAccessRequest), id: d.id }));
}

/** Свои запросы — чтобы на витрине было видно «отправлен» / «отклонён». */
export function subscribeMyGrokAccessRequests(
  workspaceId: string,
  uid: string,
  onData: (requests: GrokAccessRequest[]) => void,
  onError?: (error: FirestoreError) => void
) {
  if (!db) {
    onData([]);
    return () => {};
  }
  return onSnapshot(
    query(paths.grokAccessRequests(workspaceId), where("uid", "==", uid)),
    (snapshot) => onData(mapRequests(snapshot.docs)),
    withErrorReporting(onError)
  );
}

/**
 * Ожидающие запросы, которые этот человек вправе рассмотреть. Owner — все
 * одним запросом; управляющий — по запросу на каждый свой провайдер:
 * правило чтения проверяет право по `provider` документа, и list-запрос без
 * фильтра по провайдеру упал бы целиком (CLAUDE.md, урок про list).
 */
export function subscribePendingGrokAccessRequests(
  workspaceId: string,
  scope: GrokAppProvider[] | "all",
  onData: (requests: GrokAccessRequest[]) => void,
  onError?: (error: FirestoreError) => void
) {
  if (!db || (scope !== "all" && scope.length === 0)) {
    onData([]);
    return () => {};
  }
  const pending = query(paths.grokAccessRequests(workspaceId), where("status", "==", "pending"));
  if (scope === "all") {
    return onSnapshot(pending, (snapshot) => onData(mapRequests(snapshot.docs)), withErrorReporting(onError));
  }
  const byProvider = new Map<GrokAppProvider, GrokAccessRequest[]>();
  const emit = () => onData(Array.from(byProvider.values()).flat());
  const stops = scope.map((provider) =>
    onSnapshot(
      query(paths.grokAccessRequests(workspaceId), where("provider", "==", provider), where("status", "==", "pending")),
      (snapshot) => {
        byProvider.set(provider, mapRequests(snapshot.docs));
        emit();
      },
      withErrorReporting(onError)
    )
  );
  return () => stops.forEach((stop) => stop());
}

/**
 * Запросить доступ. Документ пишет сам человек (правило пускает только свой
 * uid и только `pending`); повтор после отказа перезаписывает тот же id.
 * Уведомление уходит тем, кто вправе открыть: управляющим раздела и Owner.
 */
export async function requestGrokAccess(input: {
  workspaceId: string;
  stub: GrokAccessStub;
  uid: string;
  name: string;
  notifyUids: string[];
}) {
  if (!db) throw new Error("Firebase не настроен");
  const id = grokAccessRequestId(input.stub.id, input.uid);
  const request: Omit<GrokAccessRequest, "id"> = {
    workspaceId: input.workspaceId,
    accountId: input.stub.id,
    provider: input.stub.provider,
    uid: input.uid,
    name: input.name,
    accountTitle: input.stub.title,
    status: "pending",
    createdAt: Date.now(),
    resolvedAt: null,
    resolvedBy: null,
    resolvedByName: null,
  };
  await setDoc(paths.grokAccessRequest(input.workspaceId, id), request);
  const service = grokAppProviderLabel(input.stub.provider, input.stub.providerOther);
  // Уведомление — не часть запроса: если оно не ушло, запрос всё равно виден
  // управляющим списком на странице.
  await sendNotification(
    {
      workspaceId: input.workspaceId,
      title: `${input.name} просит доступ к аккаунту`,
      body: `${service} · ${input.stub.title}`,
      priority: "normal",
      fromUid: input.uid,
      fromName: input.name,
      target: "selected",
      href: `/grok-limit?s=${grokSectionOfProvider(input.stub.provider)}`,
      kind: "grok-access-request",
    },
    input.notifyUids
  ).catch(() => undefined);
}

export async function withdrawGrokAccessRequest(workspaceId: string, requestId: string) {
  if (!db) throw new Error("Firebase не настроен");
  await deleteDoc(paths.grokAccessRequest(workspaceId, requestId));
}

/**
 * Рассмотреть запрос. «Открыть» дописывает человека в `allowedUids` и
 * закрывает запрос ОДНИМ batch: иначе после сбоя запрос выглядел бы
 * одобренным, а доступа бы не было. Пишется ТОЛЬКО `allowedUids`
 * (arrayUnion), флаг `restricted` не трогаем: если аккаунт тем временем
 * открыли всем, `restricted: true` с одним человеком закрыл бы его для
 * остальных — такому запросу достаточно статуса «открыт».
 *
 * Закрыт ли аккаунт, берём из самого аккаунта, а если он в список не пришёл —
 * из витрины: карточка там есть только у закрытых.
 */
export async function resolveGrokAccessRequest(input: {
  workspaceId: string;
  request: GrokAccessRequest;
  approve: boolean;
  account: GrokAppAccount | null;
  stubExists: boolean;
  actorUid: string;
  actorName: string;
}) {
  if (!db) throw new Error("Firebase не настроен");
  const restricted = input.account ? input.account.restricted === true : input.stubExists;
  if (input.approve && !input.account && !input.stubExists) {
    throw new Error("Аккаунт не найден — возможно, его удалили");
  }
  const batch = writeBatch(db);
  if (input.approve && restricted) {
    batch.update(paths.grokAppAccount(input.workspaceId, input.request.accountId), {
      allowedUids: arrayUnion(input.request.uid),
      updatedByUid: input.actorUid,
      updatedByName: input.actorName,
      updatedAt: Date.now(),
    });
  }
  batch.update(paths.grokAccessRequest(input.workspaceId, input.request.id), {
    status: input.approve ? "approved" : "declined",
    resolvedAt: Date.now(),
    resolvedBy: input.actorUid,
    resolvedByName: input.actorName,
  });
  await batch.commit();
  const service = grokAppProviderLabel(input.request.provider);
  await sendNotification(
    {
      workspaceId: input.workspaceId,
      title: input.approve ? "Доступ к аккаунту открыт" : "В доступе к аккаунту отказали",
      body: `${service} · ${input.request.accountTitle}`,
      priority: "normal",
      fromUid: input.actorUid,
      fromName: input.actorName,
      target: "selected",
      href: `/grok-limit?s=${grokSectionOfProvider(input.request.provider)}`,
      kind: "grok-access-result",
    },
    [input.request.uid]
  ).catch(() => undefined);
}
