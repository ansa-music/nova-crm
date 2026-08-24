import { useEffect } from "react";
import { updatePresenceHeartbeat } from "@/services/authService";
import { useAuth } from "@/hooks/useAuth";

const HEARTBEAT_INTERVAL_MS = 3 * 60 * 1000;

/** Mount once near the app root (inside AppLayout). Keeps this user's presence fresh across all their workspaces. */
export function usePresenceHeartbeat() {
  const { profile } = useAuth();
  const uid = profile?.uid;
  const workspaceIds = profile?.workspaceIds;

  useEffect(() => {
    if (!uid || !workspaceIds?.length) return;

    function beat() {
      if (document.visibilityState === "visible") {
        updatePresenceHeartbeat(uid!, workspaceIds!);
      }
    }

    beat();
    const interval = setInterval(beat, HEARTBEAT_INTERVAL_MS);
    document.addEventListener("visibilitychange", beat);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", beat);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, JSON.stringify(workspaceIds)]);
}
