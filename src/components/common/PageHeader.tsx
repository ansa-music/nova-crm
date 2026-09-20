import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/utils/cn";

/**
 * Шапка раздела — одна на все экраны-ленты («Столы», «Заказы», «Технари»,
 * «Люди», «Пользователи», «Настройки», «Дашборд»).
 *
 * До неё разметка была скопирована руками в шесть мест и предсказуемо
 * разъехалась: где-то eyebrow латиницей, где-то кириллицей; заголовок
 * 2.15rem против 2.2rem; отступ под шапкой mb-7 против mb-5; а «Технари» и
 * «Объявления» и вовсе носили `.page-header` — это ДРУГОЙ идиом, плоский
 * тулбар для экранов с собственным скроллом (стол, чат, Грок лимит), и рядом
 * со «Столами» такой экран выглядел чужим.
 *
 * Значения взяты дословно со «Столов» — они были эталоном: раскладка
 * `flex-col → sm:flex-row` единственная, что нормально складывается на
 * телефоне.
 */
export function PageHeader({
  eyebrow,
  title,
  titleStyle,
  description,
  actions,
  filters,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  /** Нужен ровно одному экрану — свечению заголовка на «Дашборде». */
  titleStyle?: CSSProperties;
  description?: ReactNode;
  actions?: ReactNode;
  /** Чипы-фильтры под шапкой; рисуются отдельной строкой. */
  filters?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-6", className)}>
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          {eyebrow && <p className="eyebrow mb-1 text-primary">{eyebrow}</p>}
          <h1 className="font-serif text-[1.85rem] font-medium tracking-[-0.03em] sm:text-[2.15rem]" style={titleStyle}>
            {title}
          </h1>
          {description && <p className="mt-1 max-w-[62ch] text-sm leading-6 text-muted-foreground">{description}</p>}
        </div>
        {actions && (
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:justify-end">{actions}</div>
        )}
      </header>
      {filters && <div className="mt-4 flex flex-wrap items-center gap-1.5">{filters}</div>}
    </div>
  );
}

/**
 * Чип-фильтр под шапкой. `activeTone` — для нестандартных тонов («Свободны»
 * зелёные, «Заняты» янтарные). На телефоне чип дорастает до тач-нормы, на
 * десктопе остаётся прежним.
 */
export function pageChipClass(on: boolean, activeTone = "border-primary/50 bg-primary/15 text-primary") {
  return cn(
    "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors sm:min-h-0 sm:px-2.5 sm:py-1",
    on ? activeTone : "border-border bg-background/40 text-muted-foreground hover:bg-accent hover:text-foreground"
  );
}
