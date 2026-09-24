import type { GrokLoginMethod } from "@/types/grokAccount";

/**
 * Shared company login for a non-Grok tool kept next to Grok Limit
 * (ElevenLabs, Higgsfield, Suno, …). Same pool idea: whoever last checked
 * it updates status for everyone.
 */
export type GrokAppProvider = "elevenlabs" | "higgsfield" | "suno" | "other";

export const GROK_APP_PROVIDERS: { id: GrokAppProvider; label: string }[] = [
  { id: "elevenlabs", label: "ElevenLabs" },
  { id: "higgsfield", label: "Higgsfield" },
  { id: "suno", label: "Suno" },
  { id: "other", label: "Другое" },
];

export function grokAppProviderLabel(provider: GrokAppProvider, otherName?: string): string {
  if (provider === "other") {
    const name = otherName?.trim();
    return name || "Другое";
  }
  return GROK_APP_PROVIDERS.find((p) => p.id === provider)?.label ?? provider;
}

export interface GrokAppAccount {
  id: string;
  workspaceId: string;
  provider: GrokAppProvider;
  /** Free-text name when provider is "other". */
  providerOther?: string;
  email: string;
  password: string;
  /** Card title. Optional on older rows. Only Owner/Admin may set it. */
  nickname?: string;
  loginMethod?: GrokLoginMethod;
  phone?: string;
  /** Plan / seat note, e.g. "Creator", "не безлимит". */
  note?: string;
  available?: boolean;
  /**
   * Доступ ограничен списком `allowedUids`. Отсутствие поля = аккаунт открыт
   * всем, у кого есть «Грок лимит» — так было до появления ограничений, и
   * старые записи не должны исчезнуть из списка.
   */
  restricted?: boolean;
  /** Кому открыт аккаунт. Owner и Тимлид видят всё всегда, их тут нет. */
  allowedUids?: string[];
  /** Использовано N % (0–100) — отметка человека; null/нет = не отмечали. */
  usagePct?: number | null;
  /** Когда отметили `usagePct` (мс). */
  usageAt?: number;
  /**
   * Ключ API ТОЛЬКО для чтения использования (сейчас — ElevenLabs,
   * `GET /v1/user/subscription`). Лежит рядом с паролем: та же граница —
   * кто видит аккаунт, видит и ключ, поэтому заводить ключ с одним правом
   * «User: Read». Пусто — использование не запрашивается.
   */
  apiKey?: string;
  limitResetAt: number | null;
  updatedByUid: string;
  updatedByName: string;
  updatedAt: number;
  createdAt: number;
  createdBy: string;
}
