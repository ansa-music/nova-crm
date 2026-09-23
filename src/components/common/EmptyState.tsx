import type { ReactNode } from "react";
import { cn } from "@/utils/cn";

/**
 * Пустое состояние списка/раздела. Плоское: без бирюзовой полоски и без
 * `.display` — крупный лёгкий заголовок на пустом экране тянул внимание
 * сильнее, чем сам контент на соседних страницах. Теперь это две строки
 * 13px и действие; `bordered` рисует пунктирную рамку, когда пустота должна
 * занимать место будущего списка (карточка на дашборде, панель в настройках).
 */
export function EmptyState({
  eyebrow,
  title,
  description,
  action,
  icon,
  bordered = false,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
  /** Иконка lucide над заголовком, приглушённая. */
  icon?: ReactNode;
  /** Пунктирная рамка `rounded-xl` — когда заглушка занимает место списка. */
  bordered?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-1.5 px-6 text-center",
        bordered ? "rounded-xl border border-dashed border-border py-12" : "py-16",
        className
      )}
    >
      {icon && <div className="mb-1 text-muted-foreground [&_svg]:h-5 [&_svg]:w-5">{icon}</div>}
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <p className="text-[13px] font-medium leading-5 text-foreground">{title}</p>
      {description && <p className="max-w-sm text-[13px] leading-5 text-muted-foreground">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
