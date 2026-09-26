import { useEffect, useState } from "react";
import { subscribeToAnnouncements, useAnnouncementsBackend } from "@/services/announcementService";
import type { Announcement } from "@/types";

export function useAnnouncements(workspaceId: string | null) {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [isLoading, setIsLoading] = useState(Boolean(workspaceId));
  const backend = useAnnouncementsBackend(workspaceId);

  useEffect(() => {
    if (!workspaceId) {
      setAnnouncements([]);
      setIsLoading(false);
      return;
    }
    if (!backend) return;
    setIsLoading(true);
    const unsubscribe = subscribeToAnnouncements(
      workspaceId,
      (next) => {
        setAnnouncements(next);
        setIsLoading(false);
      },
      backend
    );
    return unsubscribe;
  }, [workspaceId, backend]);

  return { announcements, isLoading, reload: () => undefined };
}
