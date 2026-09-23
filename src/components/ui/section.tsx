import * as React from "react";
import { cn } from "@/utils/cn";

export interface SectionProps extends Omit<React.HTMLAttributes<HTMLElement>, "title"> {
  /** Моно-подпись над заголовком («Сегодня», «Май 2026»). */
  eyebrow?: React.ReactNode;
  title?: React.ReactNode;
  /** Кнопка/ссылка справа в шапке — «Все», «+ Добавить». */
  action?: React.ReactNode;
  /** Полоса под контентом с рамкой сверху — итоги, пагинация. */
  footer?: React.ReactNode;
  /** `false` — тело без внутренних отступов (списки ListRow, таблицы). */
  padded?: boolean;
}

/**
 * Секция экрана: плоская карточка с шапкой «eyebrow / заголовок / действие»
 * и опциональным подвалом. Заменяет самодельные `Card + CardHeader` на
 * дашборде, в настройках и на страницах людей — там шапки были собраны
 * по-разному и заголовки прыгали от 13 до 17px.
 */
export const Section = React.forwardRef<HTMLElement, SectionProps>(
  ({ eyebrow, title, action, footer, padded = true, className, children, ...rest }, ref) => {
    const hasHeader = Boolean(eyebrow || title || action);
    return (
      <section ref={ref} className={cn("rounded-xl border border-border bg-card text-card-foreground", className)} {...rest}>
        {hasHeader && (
          <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div className="min-w-0">
              {eyebrow && <p className="eyebrow mb-0.5">{eyebrow}</p>}
              {title && <h3 className="truncate text-[13px] font-medium leading-5">{title}</h3>}
            </div>
            {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
          </header>
        )}
        <div className={cn(padded && "p-4")}>{children}</div>
        {footer && <footer className="border-t border-border px-4 py-3">{footer}</footer>}
      </section>
    );
  }
);
Section.displayName = "Section";
