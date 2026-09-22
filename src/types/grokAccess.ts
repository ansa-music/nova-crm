import type { GrokAppProvider } from "@/types/grokAppAccount";

/**
 * Право «управляет Хиксом» (и 11 Labs, и «Другими») — ОТДЕЛЬНОЕ от ролей
 * права страницы «Грок лимит». Роль (Технарь, ОС, Тимлид…) решает, пускают
 * ли человека на страницу; кто открывает закрытые аккаунты раздела и
 * рассматривает запросы на доступ — решает только этот список. Назначает
 * его Owner. Документ `workspaces/{ws}/grokSettings/access`.
 *
 * Ключ — `provider` аккаунта, а не раздел страницы: правила Firestore
 * проверяют право по `resource.data.provider`, а в языке правил нет
 * тернарного «раздел этого провайдера». Раздел «Другие» поэтому пишется под
 * двумя ключами сразу (`suno` и `other`).
 */
export interface GrokAccessSettings {
  workspaceId: string;
  managers: Partial<Record<GrokAppProvider, string[]>>;
  updatedAt: number;
  updatedBy: string;
}

export const GROK_ACCESS_DOC_ID = "access";

/** Разделы страницы, у которых есть закрытые аккаунты подписок. */
export type GrokAppSectionId = "higgsfield" | "elevenlabs" | "other";

export const GROK_SECTION_PROVIDERS: Record<GrokAppSectionId, GrokAppProvider[]> = {
  higgsfield: ["higgsfield"],
  elevenlabs: ["elevenlabs"],
  other: ["suno", "other"],
};

export function grokSectionOfProvider(provider: GrokAppProvider): GrokAppSectionId {
  return provider === "higgsfield" || provider === "elevenlabs" ? provider : "other";
}

/**
 * Карточка закрытого аккаунта БЕЗ секретов: `grokAccessStubs/{accountId}`.
 * Сам закрытый аккаунт технарь прочитать не может (в нём пароль), а
 * запросить доступ к тому, чего не видно, нельзя — поэтому рядом лежит
 * витрина: только сервис и название. Пишут её те, кто управляет разделом
 * (и Owner), — из их сессии она сверяется с настоящими аккаунтами.
 */
export interface GrokAccessStub {
  id: string;
  workspaceId: string;
  provider: GrokAppProvider;
  providerOther: string;
  /** Название аккаунта, а без него — почта со скрытой серединой. */
  title: string;
  updatedAt: number;
}

export type GrokAccessRequestStatus = "pending" | "approved" | "declined";

/** Запрос на доступ: `grokAccessRequests/{accountId}_{uid}` — один на человека и аккаунт. */
export interface GrokAccessRequest {
  id: string;
  workspaceId: string;
  accountId: string;
  provider: GrokAppProvider;
  uid: string;
  name: string;
  accountTitle: string;
  status: GrokAccessRequestStatus;
  createdAt: number;
  resolvedAt: number | null;
  resolvedBy: string | null;
  resolvedByName: string | null;
}

export function grokAccessRequestId(accountId: string, uid: string): string {
  return `${accountId}_${uid}`;
}

/** «anna.k@gmail.com» → «an•••@gmail.com»: по витрине видно, что за аккаунт, но не логин. */
export function maskedEmail(email: string): string {
  const [local, domain] = email.trim().split("@");
  if (!domain) return local ? `${local.slice(0, 2)}•••` : "аккаунт";
  return `${local.slice(0, 2)}•••@${domain}`;
}
