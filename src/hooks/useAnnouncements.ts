import { useEffect, useState } from "react";
import { subscribeToAnnouncements } from "@/services/announcementService";
import type { Announcement } from "@/types";

export function useAnnouncements(workspaceId: string | null) {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!workspaceId) {
      setAnnouncements([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const unsubscribe = subscribeToAnnouncements(
      workspaceId,
      (data) => {
        setAnnouncements(data);
        setIsLoading(false);
      },
      (error) => {
        console.error("subscribeToAnnouncements denied:", error.code, error.message);
        setAnnouncements([]);
        setIsLoading(false);
      }
    );
    return unsubscribe;
  }, [workspaceId]);

  return { announcements, isLoading };
}
