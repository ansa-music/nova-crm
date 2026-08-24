/** Same-tab ping so inbox/bell pollers refresh after a local mark-as-read write. Not a Firestore listener. */
export const INBOX_CHANGED_EVENT = "nova:inbox-changed";

export function pingInboxChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(INBOX_CHANGED_EVENT));
}
