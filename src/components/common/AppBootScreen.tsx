import { useEffect, useRef, useState } from "react";
import { BrandMark } from "@/components/common/BrandMark";
import { Button } from "@/components/ui/button";
import { signOutUser } from "@/firebase/auth";
import { useBootstrapStore } from "@/store/bootstrapStore";
import { deskEase, gsap, useGSAP } from "@/lib/gsap";
import type { BootstrapPhase } from "@/hooks/useAppBootstrap";

const PHASE_LABEL: Partial<Record<BootstrapPhase, string>> = {
  auth: "Проверяем вход…",
  profile: "Загружаем профиль…",
  workspaces: "Открываем рабочее пространство…",
  "workspace-data": "Загружаем страницы и доступы…",
};

const PHASE_ORDER: BootstrapPhase[] = ["auth", "profile", "workspaces", "workspace-data"];

/** Через сколько стадия считается «подозрительно долгой». */
const SLOW_AFTER_MS = 12_000;

/**
 * Чаще всего загрузка встаёт не из-за приложения, а из-за того, что браузер
 * не достукивается до базы: пропал интернет или расширение-«ускоритель»/
 * блокировщик рвёт долгое соединение, на котором Firestore держит связь.
 */
const NETWORK_HINT =
  "Проверьте интернет. Расширения-«ускорители» и блокировщики иногда рвут связь с базой — отключите их для этого сайта или откройте его в режиме инкогнито.";

export function AppBootScreen({ phase }: { phase: BootstrapPhase }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const bootError = useBootstrapStore((s) => s.bootError);
  // Таймер только для подсказки — ход загрузки он не меняет. Раньше экран
  // мог висеть бесконечно молча, и было не понять, ждать или что-то делать.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    const timer = window.setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);
  const failed = Boolean(bootError) && phase === "profile";
  const step = Math.max(0, PHASE_ORDER.indexOf(phase));
  const progress = ((step + 1) / PHASE_ORDER.length) * 100;

  useGSAP(
    () => {
      if (!rootRef.current) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      gsap.fromTo(
        rootRef.current.querySelector(".boot-card"),
        { opacity: 0, y: 8 },
        { opacity: 1, y: 0, duration: 0.32, ease: deskEase }
      );
    },
    { scope: rootRef }
  );

  useGSAP(
    () => {
      if (!barRef.current) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        barRef.current.style.width = `${progress}%`;
        return;
      }
      gsap.to(barRef.current, { width: `${progress}%`, duration: 0.28, ease: deskEase });
    },
    { scope: rootRef, dependencies: [progress] }
  );

  return (
    <div
      ref={rootRef}
      className="cyber-grid flex h-screen w-full flex-col items-center justify-center gap-8 bg-background"
      role="status"
      aria-live="polite"
      aria-busy={!failed}
    >
      <div className="boot-card flex w-[calc(100%-2rem)] max-w-[360px] flex-col items-center gap-6 rounded-md border border-primary/35 bg-card/95 px-8 py-10">
        <BrandMark />
        {failed ? (
          <>
            <div className="flex flex-col items-center gap-2 text-center">
              <p className="text-sm font-medium text-destructive">Не удалось загрузить профиль</p>
              <p className="text-xs leading-5 text-muted-foreground">{NETWORK_HINT}</p>
              <p className="break-all font-mono text-[10px] text-muted-foreground/70">{bootError}</p>
            </div>
            <div className="flex w-full flex-col gap-2">
              <Button className="min-h-11 w-full" onClick={() => window.location.reload()}>
                Обновить страницу
              </Button>
              <Button variant="ghost" className="min-h-11 w-full" onClick={() => void signOutUser()}>
                Выйти
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="h-px w-40 overflow-hidden bg-border">
              <div ref={barRef} className="h-full bg-primary" style={{ width: "12%" }} />
            </div>
            <p className="eyebrow">{PHASE_LABEL[phase] ?? "Загрузка…"}</p>
            {slow && (
              <div className="flex flex-col items-center gap-3 text-center">
                <p className="text-xs leading-5 text-muted-foreground">
                  Грузится дольше обычного. {NETWORK_HINT}
                </p>
                <Button variant="outline" size="sm" className="min-h-11" onClick={() => window.location.reload()}>
                  Обновить страницу
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
