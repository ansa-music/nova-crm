import { useCallback, useEffect, useState } from "react";

export interface DeskLayout {
  showLeaderboard: boolean;
  showProgress: boolean;
  showCharts: boolean;
}

const DEFAULT_LAYOUT: DeskLayout = {
  showLeaderboard: true,
  showProgress: true,
  showCharts: true,
};

const EVENT = "nova:desk-layout";

function storageKey(uid: string) {
  return `nova-desk-layout:${uid}`;
}

function readLayout(uid: string): DeskLayout {
  try {
    const raw = window.localStorage.getItem(storageKey(uid));
    if (!raw) return { ...DEFAULT_LAYOUT };
    const parsed = JSON.parse(raw) as Partial<DeskLayout>;
    return {
      showLeaderboard: parsed.showLeaderboard !== false,
      showProgress: parsed.showProgress !== false,
      showCharts: parsed.showCharts !== false,
    };
  } catch {
    return { ...DEFAULT_LAYOUT };
  }
}

function writeLayout(uid: string, layout: DeskLayout) {
  try {
    window.localStorage.setItem(storageKey(uid), JSON.stringify(layout));
    window.dispatchEvent(new Event(EVENT));
  } catch {
    /* private browsing */
  }
}

/** Personal dashboard widgets for THIS user. Not synced; uid-keyed localStorage. */
export function useDeskLayout(uid: string | undefined | null) {
  const [layout, setLayoutState] = useState<DeskLayout>(DEFAULT_LAYOUT);

  const refresh = useCallback(() => {
    if (!uid) {
      setLayoutState({ ...DEFAULT_LAYOUT });
      return;
    }
    setLayoutState(readLayout(uid));
  }, [uid]);

  useEffect(() => {
    refresh();
    window.addEventListener(EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [refresh]);

  const setLayout = useCallback(
    (patch: Partial<DeskLayout>) => {
      if (!uid) return;
      const next = { ...readLayout(uid), ...patch };
      writeLayout(uid, next);
      setLayoutState(next);
    },
    [uid]
  );

  return { layout, setLayout };
}
