import { motion } from "framer-motion";
import { BrandMark } from "@/components/common/BrandMark";
import type { BootstrapPhase } from "@/hooks/useAppBootstrap";

const PHASE_LABEL: Partial<Record<BootstrapPhase, string>> = {
  auth: "Проверяем вход…",
  profile: "Загружаем профиль…",
  workspaces: "Открываем рабочее пространство…",
  "workspace-data": "Загружаем страницы и доступы…",
};

const PHASE_ORDER: BootstrapPhase[] = ["auth", "profile", "workspaces", "workspace-data"];

export function AppBootScreen({ phase }: { phase: BootstrapPhase }) {
  const step = Math.max(0, PHASE_ORDER.indexOf(phase));
  const progress = ((step + 1) / PHASE_ORDER.length) * 100;

  return (
    <div
      className="page-surface flex h-screen w-full flex-col items-center justify-center gap-8 bg-background"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
        className="flex w-full max-w-[360px] flex-col items-center gap-6 rounded-lg border border-border/80 bg-card/80 px-8 py-10"
      >
        <BrandMark />
        <div className="h-px w-40 overflow-hidden bg-border">
          <motion.div
            className="h-full bg-primary"
            initial={{ width: "12%" }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
          />
        </div>
        <p className="eyebrow">{PHASE_LABEL[phase] ?? "Загрузка…"}</p>
      </motion.div>
    </div>
  );
}
