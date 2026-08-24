import { fetchAnnouncements } from "@/services/announcementService";
import { usePolledData } from "@/hooks/usePolledData";
import type { Announcement } from "@/types";

export function useAnnouncements(workspaceId: string | null) {
  const { data: announcements, isLoading, reload } = usePolledData<Announcement[]>(
    Boolean(workspaceId),
    () => fetchAnnouncements(workspaceId as string),
    [],
    [workspaceId]
  );

  return { announcements, isLoading, reload };
}
