import { useEffect, useRef, useState } from "react";
import { BrandMark } from "@/components/common/BrandMark";
import { Button } from "@/components/ui/button";
import { signOutUser } from "@/firebase/auth";
import { isFirestoreCompatMode, reloadInCompatMode } from "@/firebase/firebase";
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
 * не достукивается до базы. Сентябрь 2026: весь узел Google, куда Казахтелеком
 * и DNS Cloudflare отправляют firestore.googleapis.com (74.125.205.x,
 * 64.233.164.x, 108.177.14.x), отвечал на обратный канал «Unknown SID» —
 * сессия открывается, данные не приходят никогда, и SDK молча крутит ретраи.
 * База при этом была цела: DNS Google даёт другой узел, и там всё работает.
 * Адрес узла из кода не выбрать, поэтому рецепт — прямо на экране.
 */
const NETWORK_HINT =
  "Проверьте интернет. Если он есть, а база молчит, чаще всего сбоит узел Google у провайдера — помогает DNS от Google или VPN:";

const DNS_STEPS = [
  {
    where: "Chrome на компьютере",
    how: "Настройки → Конфиденциальность и безопасность → Безопасность → Использовать безопасный DNS → Google (Public DNS)",
  },
  { where: "Android", how: "Настройки → Подключения → Частный DNS → dns.google" },
  { where: "iPhone по Wi‑Fi", how: "Wi‑Fi → ⓘ у сети → Настройка DNS → Вручную → 8.8.8.8" },
];

function NetworkHelp({ lead }: { lead?: string }) {
  return (
    <div className="flex w-full flex-col gap-2 text-left">
      <p className="text-xs leading-5 text-muted-foreground">
        {lead ? `${lead} ` : ""}
        {NETWORK_HINT}
      </p>
      <ul className="flex flex-col gap-1.5">
        {DNS_STEPS.map((step) => (
          <li key={step.where} className="rounded-sm border border-border/70 px-2.5 py-1.5 text-[11px] leading-4">
            <span className="block font-medium text-foreground">{step.where}</span>
            <span className="text-muted-foreground">{step.how}</span>
          </li>
        ))}
      </ul>
      <p className="text-[11px] leading-4 text-muted-foreground">
        Потом обновите страницу. Расширения-«ускорители» тоже стоит отключить для этого сайта.
      </p>
    </div>
  );
}

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
            <div className="flex w-full flex-col items-center gap-2 text-center">
              <p className="text-sm font-medium text-destructive">Не удалось загрузить профиль</p>
              <NetworkHelp />
              <p className="break-all font-mono text-[10px] text-muted-foreground/70">{bootError}</p>
            </div>
            <div className="flex w-full flex-col gap-2">
              <Button className="min-h-11 w-full" onClick={reloadInCompatMode}>
                {isFirestoreCompatMode ? "Обновить страницу" : "Обновить в режиме совместимости"}
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
              <div className="flex w-full flex-col items-center gap-3 text-center">
                <NetworkHelp lead="Грузится дольше обычного." />
                {/* Режим совместимости переживает расширения и прокси, которые
                    копят потоковый ответ базы, — чаще всего застревание именно
                    это. Если он уже включён, остаётся обычная перезагрузка. */}
                <Button size="sm" className="min-h-11" onClick={reloadInCompatMode}>
                  {isFirestoreCompatMode ? "Обновить страницу" : "Обновить в режиме совместимости"}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
