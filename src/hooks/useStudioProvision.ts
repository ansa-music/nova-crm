import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "@/components/ui/sonner";
import { STUDIO_NAME, studioWorkspaceId } from "@/config/studio";
import { useAuthStore } from "@/store/authStore";
import { useBootstrapStore } from "@/store/bootstrapStore";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { isWorkspaceAdmin } from "@/utils/adminAccess";
import { firestoreErrorText } from "@/utils/dbError";

/**
 * «NOVA Studio» (просьба Nurba 06.10.2026): разовое автосоздание воркспейса
 * при входе администратора платформы. Оркестратор войти в прод не может, а
 * документ workspace, запись Owner и `users/{uid}.workspaceIds` пишет только
 * сам Nurba — поэтому создаёт его сессия.
 *
 * Гейт (критика I7): почта из ТОКЕНА Firebase (её же смотрит правило
 * `isPlatformAdmin`, а не профиль, который человек правит сам), срок до
 * 15.11.2026, список workspace пришёл, и студии нет в списке «готовой»
 * (`rowsBackend: "supabase"` — последний шаг ставится раньше, чем она
 * попадает в список). Раз за загрузку, одна вкладка (Web Lock), код
 * создания — динамическим `import()`: у остальных он не скачивается.
 * Автоматически никуда не переключает — только тост «Открыть».
 */

/** Отметка устройства «больше не пробовать» (создано, удалено, отказ правил). */
const MARK_PREFIX = "nova:studio-provisioned:";
/** Тост «пока не создан» — не чаще раза в сутки (повтор идёт на каждой загрузке). */
const RETRY_TOAST_PREFIX = "nova:studio-retry-toast:";
const RETRY_TOAST_EVERY_MS = 24 * 60 * 60_000;
/** До какого дня работает автосоздание (дальше — только руками, «Создать workspace»). */
const PROVISION_UNTIL = Date.parse("2026-11-15T23:59:59+05:00");

/** Один запуск на загрузку страницы (на человека). */
const started = new Set<string>();

function readStore(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStore(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Приватный режим / запрет хранилища — отметка просто не запомнится.
  }
}

function markDone(uid: string) {
  writeStore(MARK_PREFIX + uid, String(Date.now()));
}

function isPermissionDenied(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "permission-denied" || code === "42501";
}

export function useStudioProvision() {
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  const uid = useAuthStore((s) => s.firebaseUser?.uid ?? null);
  const admin = useAuthStore((s) => isWorkspaceAdmin(s.firebaseUser?.email));
  const listResolved = useBootstrapStore((s) => s.workspaceListResolved);
  const studioId = admin && uid ? studioWorkspaceId(uid) : null;
  // Узкий селектор: строка-признак, без перерисовки на каждый снимок списка.
  const studioReady = useWorkspaceStore((s) =>
    studioId ? s.workspaces.find((w) => w.id === studioId)?.rowsBackend === "supabase" : false
  );
  const due = Boolean(admin && uid && listResolved && !studioReady && Date.now() <= PROVISION_UNTIL);

  // Тост «Создан» — только когда студия уже в списке (критика I7): иначе
  // «Открыть» поставил бы активным id, которого список ещё не знает.
  const [announce, setAnnounce] = useState<string | null>(null);
  const announcedListed = useWorkspaceStore((s) => (announce ? s.workspaces.some((w) => w.id === announce) : false));

  useEffect(() => {
    if (!due || !uid) return;
    if (started.has(uid) || readStore(MARK_PREFIX + uid)) return;
    started.add(uid);
    const user = useAuthStore.getState();
    const email = (user.firebaseUser?.email ?? "").trim().toLowerCase();
    const ownerName = user.profile?.name?.trim() || user.profile?.nickname?.trim() || email;
    // Ник — как есть: самолечение ника при входе сравнивает строку целиком.
    const nickname = user.profile?.nickname || undefined;
    const listedBefore = useWorkspaceStore.getState().workspaces.some((w) => w.id === studioWorkspaceId(uid));

    void import("@/services/studioService")
      .then((studio) =>
        studio.runWithStudioLock(
          "nova-studio-provision",
          () =>
            studio.provisionStudioWorkspace({
              uid,
              email,
              ownerName,
              nickname,
              workspaces: useWorkspaceStore.getState().workspaces,
            }),
          { ifAvailable: true }
        )
      )
      .then((result) => {
        // null — создание идёт в другой вкладке этого браузера.
        if (!result) return;
        switch (result.kind) {
          case "provisioned":
            markDone(uid);
            if (!listedBefore) setAnnounce(result.workspaceId);
            return;
          case "exists":
          case "done":
          case "deleted":
          case "foreign":
            markDone(uid);
            return;
          case "retry":
            console.warn("[studio] регистрация NOVA Studio в Supabase не прошла — повтор при следующей загрузке:", result.reason);
            notifyRetry(uid, result.reason);
            return;
        }
      })
      .catch((error: unknown) => {
        const reason = firestoreErrorText(error, "Не удалось записать в базу");
        if (isPermissionDenied(error)) {
          // Правила не пускают (почта токена не та) — не стучимся на каждой
          // загрузке. Отметка навсегда, поэтому тост один.
          markDone(uid);
          console.warn("[studio] создание NOVA Studio отклонено правилами — больше не пробуем на этом устройстве", error);
          toast.error(`${STUDIO_NAME} не создан`, {
            description: `${reason} — на этом устройстве больше не пробую.`,
            duration: 20_000,
          });
          return;
        }
        console.warn("[studio] создание NOVA Studio не удалось — повтор при следующей загрузке", error);
        notifyRetry(uid, reason);
      });
  }, [due, uid]);

  useEffect(() => {
    if (!announce || !announcedListed) return;
    const id = announce;
    setAnnounce(null);
    toast.success(`Создан воркспейс ${STUDIO_NAME}`, {
      description: "Он в списке ваших workspace. Пригласите людей ссылкой со страницы «Пользователи».",
      duration: 20_000,
      action: {
        label: "Открыть",
        onClick: () => {
          useWorkspaceStore.getState().setActiveWorkspaceId(id);
          navigateRef.current("/");
        },
      },
    });
  }, [announce, announcedListed]);
}

/**
 * Создание не дошло до конца (ревью M3): без тоста Nurba не узнал бы ни о
 * попытке, ни о причине — повтор идёт молча на каждой загрузке. Не чаще
 * раза в сутки на человека.
 */
function notifyRetry(uid: string, reason: string) {
  const key = RETRY_TOAST_PREFIX + uid;
  const last = Number(readStore(key) ?? 0);
  if (Date.now() - last < RETRY_TOAST_EVERY_MS) return;
  writeStore(key, String(Date.now()));
  toast.error(`${STUDIO_NAME} пока не создан`, {
    description: `${reason} — повторю при следующей загрузке.`,
    duration: 20_000,
  });
}
