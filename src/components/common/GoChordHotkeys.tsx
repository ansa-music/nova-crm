import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "@/hooks/useAuth";
import { useWorkspace } from "@/hooks/useWorkspace";
import { usePermissions } from "@/hooks/usePermissions";
import { readPinnedPageIds } from "@/hooks/useUserPageNav";

const CHORD_MS = 800;

function isTypingTarget(el: EventTarget | null): boolean {
  const active = (el as HTMLElement | null) ?? (document.activeElement as HTMLElement | null);
  if (!active) return false;
  const tag = (active.tagName ?? "").toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || Boolean(active.isContentEditable);
}

/**
 * Linear/Gmail-style G-then-letter, using e.code (layout-independent).
 * Bare KeyG (no ctrl/meta/alt) arms a short window; second key navigates.
 * Does not steal Ctrl+K / undo (those use modifiers).
 */
export function GoChordHotkeys() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { pages } = useWorkspace();
  const permissions = usePermissions();
  const [armed, setArmed] = useState(false);
  const timerRef = useRef<number | null>(null);
  const pagesRef = useRef(pages);
  const permissionsRef = useRef(permissions);
  const uidRef = useRef(profile?.uid);

  pagesRef.current = pages;
  permissionsRef.current = permissions;
  uidRef.current = profile?.uid;

  function disarm() {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    setArmed(false);
  }

  function firstDeskHref(): string | null {
    const accessible = pagesRef.current.filter((p) => permissionsRef.current.canAccessPage(p));
    if (accessible.length === 0) return null;
    const pinned = uidRef.current ? readPinnedPageIds(uidRef.current) : [];
    const pinnedPage = pinned.map((id) => accessible.find((p) => p.id === id)).find((page) => page !== undefined);
    const target = pinnedPage ?? accessible[0];
    return target ? `/page/${target.id}` : null;
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingTarget(e.target)) {
        if (armed) disarm();
        return;
      }

      if (!armed) {
        if (e.code !== "KeyG" || e.repeat) return;
        e.preventDefault();
        setArmed(true);
        if (timerRef.current) window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => {
          setArmed(false);
          timerRef.current = null;
        }, CHORD_MS);
        return;
      }

      e.preventDefault();
      const code = e.code;
      disarm();
      if (code === "KeyD") {
        navigate("/");
        return;
      }
      if (code === "KeyS" || code === "KeyP") {
        const href = firstDeskHref();
        if (href) navigate(href);
        return;
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [armed, navigate]);

  if (!armed) return null;

  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-[80] -translate-x-1/2 rounded-md border border-border/80 bg-card/90 px-3 py-1.5 font-mono text-[12px] text-muted-foreground shadow-lg backdrop-blur">
      G …
    </div>
  );
}
