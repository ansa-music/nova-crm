import { create } from "zustand";

/**
 * Promise-based confirm / prompt dialogs that render through the app's own
 * Dialog primitive (see components/common/AppDialogHost.tsx) instead of the
 * browser's native `window.confirm` / `window.prompt`.
 *
 * Why: native dialogs are unstyled, block the whole tab, ignore the app's
 * dark theme, can't show a destructive accent, and on iOS Safari sometimes
 * don't return focus to the page. Every call site in the app goes through
 * these two helpers now — the usage shape is deliberately identical to the
 * native one (`if (!(await confirmDialog(...))) return;`), so swapping the
 * implementation back is a one-line change if ever needed.
 *
 * Only ONE dialog is shown at a time; a second request while one is open
 * resolves the previous one as cancelled first.
 */

export interface ConfirmDialogOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button + warning tone for irreversible actions. */
  destructive?: boolean;
}

export interface PromptDialogOptions {
  title: string;
  description?: string;
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Multi-line text area instead of a single-line input. */
  multiline?: boolean;
  /** Max length hint shown as a counter; not enforced server-side. */
  maxLength?: number;
  /** Return a message to block submit, or null/undefined when the value is fine. */
  validate?: (value: string) => string | null | undefined;
}

type ActiveDialog =
  | { kind: "confirm"; id: number; options: ConfirmDialogOptions; resolve: (ok: boolean) => void }
  | { kind: "prompt"; id: number; options: PromptDialogOptions; resolve: (value: string | null) => void };

interface AppDialogState {
  active: ActiveDialog | null;
  open: (dialog: ActiveDialog) => void;
  close: () => void;
}

let nextId = 1;

export const useAppDialogStore = create<AppDialogState>((set, get) => ({
  active: null,
  open: (dialog) => {
    const prev = get().active;
    if (prev) {
      if (prev.kind === "confirm") prev.resolve(false);
      else prev.resolve(null);
    }
    set({ active: dialog });
  },
  close: () => set({ active: null }),
}));

export function confirmDialog(options: ConfirmDialogOptions | string): Promise<boolean> {
  const opts: ConfirmDialogOptions = typeof options === "string" ? { title: options } : options;
  return new Promise<boolean>((resolve) => {
    useAppDialogStore.getState().open({ kind: "confirm", id: nextId++, options: opts, resolve });
  });
}

export function promptDialog(options: PromptDialogOptions | string, defaultValue?: string): Promise<string | null> {
  const opts: PromptDialogOptions =
    typeof options === "string" ? { title: options, defaultValue } : { defaultValue, ...options };
  return new Promise<string | null>((resolve) => {
    useAppDialogStore.getState().open({ kind: "prompt", id: nextId++, options: opts, resolve });
  });
}

/** Resolve the active dialog and dismiss it. Used by the host component only. */
export function settleActiveDialog(result: boolean | string | null) {
  const { active, close } = useAppDialogStore.getState();
  if (!active) return;
  if (active.kind === "confirm") active.resolve(Boolean(result));
  else active.resolve(typeof result === "string" ? result : null);
  close();
}
