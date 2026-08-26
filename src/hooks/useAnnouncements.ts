import { useEffect, useState } from "react";
import { subscribeToAnnouncements } from "@/services/announcementService";
import type { Announcement } from "@/types";

export function useAnnouncements(workspaceId: string | null) {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [isLoading, setIsLoading] = useState(Boolean(workspaceId));

  useEffect(() => {
    if (!workspaceId) {
      setAnnouncements([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const unsubscribe = subscribeToAnnouncements(workspaceId, (next) => {
      setAnnouncements(next);
      setIsLoading(false);
    });
    return unsubscribe;
  }, [workspaceId]);

  return { announcements, isLoading, reload: () => undefined };
}
