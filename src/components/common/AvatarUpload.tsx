import { useRef, useState } from "react";
import { Camera, Loader2, Trash2 } from "lucide-react";
import { MemberAvatar } from "@/components/common/MemberAvatar";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import {
  ALLOWED_AVATAR_MIMES,
  MAX_AVATAR_BYTES,
  removeUserAvatar,
  uploadUserAvatar,
  validateAvatarFile,
} from "@/services/avatarService";
import type { AppUser } from "@/types";

/**
 * Личная аватарка. Одна на человека и не имеет отношения к обложке стола:
 * обложка — про стол, эта — про самого человека и видна везде, где рисуется
 * `MemberAvatar` (участники, «Технари», заказы, чат, канбан).
 *
 * Предпросмотр показывается ЧЕРЕЗ `MemberAvatar`, а не отдельной вёрсткой:
 * иначе буквы-заглушка здесь и в остальном приложении разъезжались бы по
 * цвету и инициалам, и человек настраивал бы не то, что потом увидит.
 */
export function AvatarUpload({
  profile,
  workspaceId,
  className,
}: {
  profile: AppUser;
  /** Куда физически класть файл; null — человек ещё ни в одном workspace. */
  workspaceId: string | null;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null);
  const workspaceIds = profile.workspaceIds ?? [];

  async function handleFile(file: File | undefined) {
    if (!file) return;
    const problem = validateAvatarFile(file);
    if (problem) {
      toast.error(problem);
      return;
    }
    if (!workspaceId) {
      toast.error("Аватарку можно загрузить, когда вы состоите хотя бы в одном workspace");
      return;
    }
    setBusy("upload");
    try {
      await uploadUserAvatar({
        uid: profile.uid,
        workspaceId,
        workspaceIds,
        file,
        previousPath: profile.photoPath,
      });
      toast.success("Аватарка обновлена");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось загрузить аватарку");
    } finally {
      setBusy(null);
    }
  }

  async function handleRemove() {
    setBusy("remove");
    try {
      await removeUserAvatar({ uid: profile.uid, workspaceIds, photoPath: profile.photoPath });
      toast.success("Аватарка убрана");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось убрать аватарку");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={className}>
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy !== null}
          title="Сменить аватарку"
          className="group relative shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <MemberAvatar
            id={profile.uid}
            name={profile.name}
            nickname={profile.nickname}
            photoURL={profile.photoURL}
            className="h-16 w-16 ring-1 ring-primary/30"
          />
          <span className="absolute inset-0 flex items-center justify-center rounded-full bg-background/70 opacity-0 transition-opacity group-hover:opacity-100">
            {busy === "upload" ? (
              <Loader2 className="h-5 w-5 animate-spin text-foreground" />
            ) : (
              <Camera className="h-5 w-5 text-foreground" />
            )}
          </span>
        </button>

        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => inputRef.current?.click()}
              disabled={busy !== null}
            >
              {busy === "upload" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {profile.photoURL ? "Сменить фото" : "Загрузить фото"}
            </Button>
            {profile.photoURL && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => void handleRemove()}
                disabled={busy !== null}
              >
                {busy === "remove" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                Убрать
              </Button>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">
            jpeg, png или webp, до {Math.round(MAX_AVATAR_BYTES / (1024 * 1024))} МБ. Видна всем участникам — это
            ваша личная аватарка, с обложкой стола она не связана.
          </p>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={[...ALLOWED_AVATAR_MIMES].join(",")}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Сбрасываем значение: иначе повторный выбор ТОГО ЖЕ файла (после
          // неудачной загрузки) не даёт события change и выглядит так, будто
          // кнопка не работает.
          e.target.value = "";
          void handleFile(file);
        }}
      />
    </div>
  );
}
