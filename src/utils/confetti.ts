import confetti from "canvas-confetti";
import { currentSiteConfig } from "@/config/siteTerms";
import { isCosmosSite } from "@/config/studio";

/**
 * Конфетти «космоса» (воркспейс «NOVA Studio», 06.10.2026): звёзды цветами
 * студии — оранжевый акцент, звёздный лёд, золото (только как свечение,
 * статусов им не красим) и молочный текст. Нет флага `theme.fx` — null, и
 * конфетти ровно прежние.
 */
const COSMOS_CONFETTI_COLORS = ["#FF7733", "#8FA2FF", "#FFC978", "#F1EEE6", "#B9A6FF"];

export function cosmosConfettiStyle(): Pick<confetti.Options, "shapes" | "colors"> | null {
  if (!isCosmosSite(currentSiteConfig())) return null;
  return { shapes: ["star"], colors: COSMOS_CONFETTI_COLORS };
}

/**
 * A short, tasteful confetti burst — fired once when a row's status changes
 * TO something that reads as "done" (e.g. "Готово"). Colors match the
 * product's accent + a success green so it feels native, not generic.
 */
export function celebrateDone() {
  const cosmos = cosmosConfettiStyle();
  if (cosmos) {
    // Под «космосом» — звёзды и уважение к «меньше движения» (у общего
    // конфетти его нет, и менять это для всех не будем).
    confetti({
      particleCount: 70,
      spread: 70,
      startVelocity: 35,
      origin: { x: 0.5, y: 0.7 },
      scalar: 0.9,
      ticks: 150,
      ...cosmos,
      disableForReducedMotion: true,
    });
    return;
  }
  const colors = ["#FF4A22", "#22c55e", "#EDE7DC"];
  confetti({
    particleCount: 70,
    spread: 70,
    startVelocity: 35,
    origin: { x: 0.5, y: 0.7 },
    colors,
    scalar: 0.9,
    ticks: 150,
  });
}
