import confetti from "canvas-confetti";

/**
 * A short, tasteful confetti burst — fired once when a row's status changes
 * TO something that reads as "done" (e.g. "Готово"). Colors match the
 * product's accent + a success green so it feels native, not generic.
 */
export function celebrateDone() {
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
