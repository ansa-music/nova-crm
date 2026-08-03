import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router";
import { toast } from "@/components/ui/sonner";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useInboxSummary } from "@/hooks/useInboxSummary";
import { displayNameOf } from "@/utils/displayName";

/** Mount once near the app root. Renders nothing — purely a side-effect watcher. */
export function GlobalMessageToaster() {
  const { profile } = useAuth();
  const { activeWorkspaceId, members } = useWorkspace();
  const { conversations } = useInboxSummary(activeWorkspaceId, profile?.uid ?? null);
  const location = useLocation();
  const navigate = useNavigate();

  const seenConversationTimestamps = useRef<Map<string, number>>(new Map());
  const isFirstRun = useRef(true);

  useEffect(() => {
    // Don't toast for the very first snapshot on load — only for messages
    // that arrive AFTER the app is already open and watching.
    if (isFirstRun.current) {
      conversations.forEach((c) => seenConversationTimestamps.current.set(c.id, c.lastMessageAt));
      isFirstRun.current = false;
      return;
    }

    for (const c of conversations) {
      const previouslySeenAt = seenConversationTimestamps.current.get(c.id) ?? 0;
      const isNew = c.lastMessageAt > previouslySeenAt;
      seenConversationTimestamps.current.set(c.id, c.lastMessageAt);
      if (!isNew || c.lastMessageFromUid === profile?.uid) continue;

      const alreadyViewing = location.pathname === "/messages";
      if (alreadyViewing) continue;

      const fromMember = members.find((m) => m.uid === c.lastMessageFromUid);
      toast(`${fromMember ? displayNameOf(fromMember) : c.lastMessageFromName} написал(а) вам`, {
        description: c.lastMessageText,
        action: {
          label: "Открыть",
          onClick: () => navigate("/messages"),
        },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations]);

  return null;
}
