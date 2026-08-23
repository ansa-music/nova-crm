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

  useEffect(() => {
    for (const c of conversations) {
      // First time THIS conversation is seen in the session — record its
      // current timestamp as the baseline and move on, don't toast.
      //
      // The bug this fixes: `conversations` starts as an empty array while
      // Firestore's subscription is still loading, so the very first
      // effect run had nothing in it. A global "isFirstRun" flag consumed
      // by that empty run meant the SECOND run — the one with the actual
      // data — was treated as "not first" anymore, so every already-read
      // conversation looked "new" (baseline of 0) and got toasted again on
      // every single page load/reopen. Keying the baseline per conversation
      // id instead of by call order fixes that regardless of how many
      // empty/intermediate renders happen before real data settles.
      if (!seenConversationTimestamps.current.has(c.id)) {
        seenConversationTimestamps.current.set(c.id, c.lastMessageAt);
        continue;
      }

      const previouslySeenAt = seenConversationTimestamps.current.get(c.id)!;
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
