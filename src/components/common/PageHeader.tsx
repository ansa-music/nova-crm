import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/utils/cn";
import { chipClass, type ChipTone } from "@/components/ui/chip";

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
 * Заголовок — тот же, что у шапки стола (`font-serif text-[26px] font-light`):
 * переход стол ↔ раздел не должен менять масштаб. Раскладка
 * `flex-col → sm:flex-row` единственная, что нормально складывается на телефоне.
 */
export function PageHeader({
  eyebrow,
  title,
  titleStyle: _titleStyle,
  description,
  actions,
  filters,
  compact = false,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  /**
   * @deprecated Не применяется: свечение заголовка («Дашборд») убрано вместе
   * с остальным неоном. Проп оставлен, чтобы не ломать вызов, — удалить вместе
   * с `greetingGlowShadow` в `utils/date.ts`.
   */
  titleStyle?: CSSProperties;
  description?: ReactNode;
  actions?: ReactNode;
  /** Чипы-фильтры под шапкой; рисуются отдельной строкой. */
  filters?: ReactNode;
  /** Компактная шапка (вложенные разделы, панели): h1 22px и отступ mb-3. */
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={cn(compact ? "mb-3" : "mb-6", className)}>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        {/* flex-1 обязателен: без него блок заголовка в ряду с широкими
            действиями (поиск + чипы) сжимался до ширины слова, и описание
            «Столов» рассыпалось столбиком по одному слову. */}
        <div className="min-w-0 sm:flex-1">
          {eyebrow && <p className="eyebrow mb-1">{eyebrow}</p>}
          <h1
            className={cn(
              "font-serif font-light tracking-[-0.01em]",
              compact ? "text-[22px] leading-7" : "text-[26px] leading-8 sm:text-[28px] sm:leading-9"
            )}
          >
            {title}
          </h1>
          {description && <p className="mt-1 max-w-[62ch] text-[13px] leading-5 text-muted-foreground">{description}</p>}
        </div>
        {actions && (
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:justify-end">{actions}</div>
        )}
      </header>
      {filters && <div className={cn("flex flex-wrap items-center gap-1.5", compact ? "mt-2" : "mt-4")}>{filters}</div>}
    </div>
  );
}

/**
 * Чип-фильтр под шапкой — совместимый хелпер поверх `chipClass` из
 * `ui/chip.tsx`, чтобы 15 вызовов не переписывать. `activeTone` — либо тон
 * чипа (`"success"`, `"danger"`…), либо старая строка классов («Свободны»
 * зелёные, «Заняты» красные) — она докладывается поверх и через tailwind-merge
 * побеждает. Тач-норму даёт тач-блок index.css по классу `.chip`.
 */
const CHIP_TONES: ReadonlySet<string> = new Set<ChipTone>(["neutral", "primary", "success", "warning", "danger"]);

export function pageChipClass(on: boolean, activeTone?: string) {
  const isTone = activeTone !== undefined && CHIP_TONES.has(activeTone);
  return cn(
    chipClass({ active: on, tone: isTone ? (activeTone as ChipTone) : "neutral", size: "md" }),
    on && activeTone && !isTone && activeTone
  );
}
