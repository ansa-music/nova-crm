// PATH: src/hooks/useUnsavedGuard.ts  (NEW FILE)
import { useEffect } from "react";

/**
 * Blocks a tab close / hard reload while a cell write is still in flight or
 * has failed. Pairs with useCellCommit.hasUnsavedWork.
 *
 * Only guards the browser-level exit. In-app navigation deliberately stays
 * unblocked: pending writes survive unmount by design (see useCellCommit), so
 * interrupting the user's flow with a confirm dialog would be pure friction.
 */
export function useUnsavedGuard(hasUnsavedWork: boolean) {
  useEffect(() => {
    if (!hasUnsavedWork) return;
    function handler(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasUnsavedWork]);
}
