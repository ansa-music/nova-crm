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

export function pushUndoCommand(cmd: UndoCommand) {
  undoStack.push(cmd);
  if (undoStack.length > 100) undoStack.shift();
  redoStack.length = 0;
}

export async function undo() {
  const cmd = undoStack.pop();
  if (!cmd) {
    toast.info("Нечего отменять");
    return;
  }
  await cmd.undo();
  redoStack.push(cmd);
}

export async function redo() {
  const cmd = redoStack.pop();
  if (!cmd) {
    toast.info("Нечего вернуть");
    return;
  }
  await cmd.redo();
  undoStack.push(cmd);
}
