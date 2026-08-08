// PATH: src/hooks/useCellCommit.ts  (NEW FILE)
import { useCallback, useEffect, useRef, useState } from "react";

export type SaveState = "idle" | "saving" | "saved" | "error";

interface PendingWrite {
  /** Value the user actually typed. Always wins over any server snapshot. */
  value: string | number | null;
  /** Monotonic sequence number — the ONLY thing used to order writes. */
  seq: number;
}

interface UseCellCommitOptions {
  /** Performs the actual Firestore write. Must reject on failure. */
  write: (rowId: string, field: string, value: string | number | null) => Promise<void>;
  /** Fired after a failed write so the caller can toast/retry. */
  onError?: (error: unknown, retry: () => void) => void;
}

function cellKey(rowId: string, field: string) {
  return `${rowId}::${field}`;
}

/**
 * The anti-data-loss layer for table editing.
 *
 * Three distinct bugs are being fixed here, and they need three different
 * mechanisms — this is why a plain "await updateRowCell()" was never enough:
 *
 * 1. TEXT DISAPPEARS ON ENTER/BLUR.
 *    The realtime snapshot for the row arrives a few hundred ms after the
 *    optimistic local edit, still carrying the OLD value, and overwrites what
 *    was just typed. Fix: `overlay` — a local map of pending values that is
 *    layered ON TOP of every snapshot until the write for that exact cell has
 *    been confirmed. Read cells through `resolveValue()` and a stale snapshot
 *    can no longer win.
 *
 * 2. TWO FAST EDITS IN A ROW, WRONG ONE STICKS.
 *    Firestore does not guarantee that two in-flight writes to the same field
 *    resolve in the order they were issued. Fix: a per-cell monotonic `seq`.
 *    A completed write only clears the overlay if its seq is still the latest
 *    one for that cell — otherwise the newer keystroke stays authoritative.
 *
 * 3. SAVE FAILS AND THE INPUT IS WIPED.
 *    Fix: on error the overlay is KEPT (never rolled back to the server value)
 *    and the cell is marked "error" with a working retry. The user's text
 *    stays on screen and stays editable.
 *
 * Deliberately no debounce on the commit itself: debouncing a commit is what
 * makes "navigate away immediately after typing" lose data. Commits fire on
 * the real intent boundary (Enter/Tab/blur) and the overlay covers the gap.
 */
export function useCellCommit({ write, onError }: UseCellCommitOptions) {
  const [overlay, setOverlay] = useState<Record<string, PendingWrite>>({});
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({});

  const seqRef = useRef(0);
  const latestSeqRef = useRef<Record<string, number>>({});
  const mountedRef = useRef(true);
  const savedTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    mountedRef.current = true;
    const timers = savedTimersRef.current;
    return () => {
      mountedRef.current = false;
      // Only clears the cosmetic "saved" badge timers. No pending WRITE is ever
      // cancelled on unmount — an in-flight save must complete even if the user
      // navigates away mid-keystroke.
      Object.values(timers).forEach(clearTimeout);
    };
  }, []);

  const commit = useCallback(
    (rowId: string, field: string, value: string | number | null) => {
      const key = cellKey(rowId, field);
      const seq = ++seqRef.current;
      latestSeqRef.current[key] = seq;

      // 1. Local state FIRST, synchronously. From this moment the UI shows the
      //    user's value no matter what any snapshot says.
      setOverlay((prev) => ({ ...prev, [key]: { value, seq } }));
      setSaveStates((prev) => ({ ...prev, [key]: "saving" }));

      const run = () => {
        write(rowId, field, value)
          .then(() => {
            if (!mountedRef.current) return;
            // Superseded by a newer keystroke — keep the newer overlay.
            if (latestSeqRef.current[key] !== seq) return;

            setSaveStates((prev) => ({ ...prev, [key]: "saved" }));
            // Hold the overlay one extra tick past confirmation: the confirming
            // snapshot may not have reached the local cache yet, and dropping
            // the overlay too early re-exposes the old value for a frame.
            clearTimeout(savedTimersRef.current[key]);
            savedTimersRef.current[key] = setTimeout(() => {
              if (!mountedRef.current) return;
              if (latestSeqRef.current[key] !== seq) return;
              setOverlay((prev) => {
                const next = { ...prev };
                delete next[key];
                return next;
              });
              setSaveStates((prev) => {
                const next = { ...prev };
                delete next[key];
                return next;
              });
            }, 1200);
          })
          .catch((error) => {
            console.error(`Cell write failed [${key}]:`, error);
            if (!mountedRef.current) return;
            if (latestSeqRef.current[key] !== seq) return;
            // NOTE: overlay is intentionally NOT cleared. The typed value stays.
            setSaveStates((prev) => ({ ...prev, [key]: "error" }));
            onError?.(error, run);
          });
      };

      run();
    },
    [write, onError]
  );

  /**
   * Read a cell's display value. ALWAYS use this instead of reading
   * `row.cells[field]` directly — that is the single line that decides whether
   * a stale snapshot can eat a keystroke.
   */
  const resolveValue = useCallback(
    (rowId: string, field: string, snapshotValue: string | number | null) => {
      const pending = overlay[cellKey(rowId, field)];
      return pending ? pending.value : snapshotValue;
    },
    [overlay]
  );

  const getSaveState = useCallback(
    (rowId: string, field: string): SaveState => saveStates[cellKey(rowId, field)] ?? "idle",
    [saveStates]
  );

  const retry = useCallback(
    (rowId: string, field: string) => {
      const pending = overlay[cellKey(rowId, field)];
      if (pending) commit(rowId, field, pending.value);
    },
    [overlay, commit]
  );

  const hasUnsavedWork = Object.values(saveStates).some((s) => s === "saving" || s === "error");
  const hasFailedWrites = Object.values(saveStates).some((s) => s === "error");

  return { commit, resolveValue, getSaveState, retry, hasUnsavedWork, hasFailedWrites };
}
