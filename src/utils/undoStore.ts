import { useSyncExternalStore } from "react";
import { toast } from "@/components/ui/sonner";

export interface UndoCommand {
  undo: () => Promise<void> | void;
  redo: () => Promise<void> | void;
}

/**
 * A single, app-wide stack — not scoped to whichever table happens to be
 * mounted. Deleting a whole page/subpage navigates you away from it
 * immediately, which would destroy a component-local stack before you ever
 * get a chance to press Ctrl+Z; keeping this at module scope means it
 * survives that navigation.
 *
 * Still entirely local to this browser tab/session — it can only undo
 * actions YOU made since this tab was opened, never another person's edits
 * or anything from before a page reload. That's an intentional boundary,
 * not a bug: a "shared" undo that reaches into other people's sessions
 * would be a much riskier, fundamentally different feature.
 */
const undoStack: UndoCommand[] = [];
const redoStack: UndoCommand[] = [];

// Tiny external store so toolbars can render enabled/disabled Undo/Redo
// buttons (phones have no Ctrl+Z) without every table re-implementing it.
type UndoSnapshot = { canUndo: boolean; canRedo: boolean; undoCount: number; redoCount: number };
const listeners = new Set<() => void>();
let snapshot: UndoSnapshot = { canUndo: false, canRedo: false, undoCount: 0, redoCount: 0 };
function emit() {
  snapshot = {
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    undoCount: undoStack.length,
    redoCount: redoStack.length,
  };
  listeners.forEach((l) => l());
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function getSnapshot() {
  return snapshot;
}
export function useUndoState(): UndoSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function pushUndoCommand(cmd: UndoCommand) {
  undoStack.push(cmd);
  if (undoStack.length > 20) undoStack.shift();
  redoStack.length = 0;
  emit();
}

export async function undo() {
  const cmd = undoStack.pop();
  if (!cmd) {
    toast.info("Нечего отменять");
    return;
  }
  emit();
  try {
    await cmd.undo();
    redoStack.push(cmd);
  } catch (error) {
    undoStack.push(cmd);
    toast.error(error instanceof Error ? error.message : "Не удалось отменить");
  }
  emit();
}

export async function redo() {
  const cmd = redoStack.pop();
  if (!cmd) {
    toast.info("Нечего вернуть");
    return;
  }
  emit();
  try {
    await cmd.redo();
    undoStack.push(cmd);
  } catch (error) {
    redoStack.push(cmd);
    toast.error(error instanceof Error ? error.message : "Не удалось вернуть");
  }
  emit();
}
