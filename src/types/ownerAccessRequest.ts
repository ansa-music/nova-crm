import type { Role } from "./role";

export type OwnerAccessRequestStatus = "pending" | "approved" | "denied";

/**
 * Заявка на права Owner, поданная ключом доступа в «Настройки → Ключ доступа».
 *
 * Документ живёт под id = uid заявителя: одна открытая заявка на человека,
 * повторный ввод ключа просто перезаписывает её. Сам ключ сюда НЕ пишется —
 * он только открывает кнопку «Отправить запрос»; настоящие права даёт Owner,
 * подтверждая заявку (`members/{uid}.role = 'owner'`, это умеет только Owner
 * по firestore.rules).
 */
export interface OwnerAccessRequest {
  id: string;
  workspaceId: string;
  fromUid: string;
  fromName: string;
  fromEmail: string;
  status: OwnerAccessRequestStatus;
  createdAt: number;
  updatedAt: number;
  resolvedByUid?: string | null;
  resolvedByName?: string | null;
  /**
   * sha256(`${workspaceId}:${ключ}`) в hex — правило заявки сверяет его с
   * `ownerAccess/key.hash` (ключ Owner может сменить). Сам ключ сюда не пишется.
   */
  keyHash?: string;
  /** Какую роль выдал Owner по заявке (не обязательно Owner). */
  grantedRole?: Role | null;
}
