export type NotificationTargetKind = "all" | "selected" | "role" | "responsible";

export interface Notification {
  id: string;
  workspaceId: string;
  targetUid: string;
  title: string;
  body: string;
  priority: "normal" | "important" | "urgent";
  fromUid: string;
  fromName: string;
  read: boolean;
  createdAt: number;
  relatedAnnouncementId?: string | null;
  pageId?: string | null;
  href?: string | null;
  kind?:
    | "view-request"
    | "view-request-result"
    | "owner-request"
    | "owner-request-result"
    | "grok-access-request"
    | "grok-access-result"
    | "success-request"
    | "order-request"
    | null;
  viewRequestId?: string | null;
  /** id заявки на права Owner (совпадает с uid заявителя) — для кнопок в колокольчике. */
  ownerRequestId?: string | null;
  /**
   * Откуда пришло (только на чтении, в базы не пишется): в режиме Supabase
   * колокольчик склеивает `notifications` Supabase и узкий хвост Firestore
   * (уведомления от вкладок на старом коде), и «прочитано» надо писать туда,
   * где строка лежит. Нет поля — Firestore, как раньше.
   */
  source?: "firestore" | "supabase";
  /** Номер правки строки Supabase — граница «прочитать всё» одним UPDATE. */
  rev?: number;
}

