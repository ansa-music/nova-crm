import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { displayNameOf } from "@/utils/displayName";
import { cn } from "@/utils/cn";

// Cool navy/cyan/teal hues so avatars sit in the neon chrome without purple or walnut.
const AVATAR_HUES = [199, 189, 217, 164, 222, 175, 205, 152];

/** Same id always maps to the same hue — no lookups, no storage needed. */
function hueFromId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_HUES[hash % AVATAR_HUES.length];
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

interface MemberAvatarProps {
  id: string;
  name?: string;
  nickname?: string;
  photoURL?: string | null;
  className?: string;
}

export function MemberAvatar({ id, name, nickname, photoURL, className }: MemberAvatarProps) {
  const label = displayNameOf({ name, nickname });
  const hue = hueFromId(id);
  return (
    <Avatar className={cn("h-8 w-8", className)}>
      {photoURL && <AvatarImage src={photoURL} alt={label} />}
      <AvatarFallback
        className="bg-none text-[11px] font-semibold"
        style={{ backgroundColor: `hsl(${hue} 55% 32%)`, color: `hsl(${hue} 70% 85%)` }}
      >
        {initialsOf(label)}
      </AvatarFallback>
    </Avatar>
  );
}
