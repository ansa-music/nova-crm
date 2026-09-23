import * as React from "react";
import { Link } from "react-router";
import { cn } from "@/utils/cn";

export interface ListRowProps extends Omit<React.HTMLAttributes<HTMLElement>, "title" | "onClick"> {
  /** Иконка/аватар слева, 16–32px. */
  leading?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Справа: число моно, бейдж, стрелка. */
  trailing?: React.ReactNode;
  onClick?: React.MouseEventHandler<HTMLElement>;
  /** Выбранная строка: подложка акцентом и полоска 2px слева. */
  active?: boolean;
  /** Строка-ссылка — рисуется `<Link>` роутера, работает Ctrl-клик и «открыть в новой вкладке». */
  href?: string;
  disabled?: boolean;
}

/**
 * Строка списка (люди, столы, уведомления, результаты поиска). Сама выбирает
 * тег: `<Link>` при `href`, `<button>` при `onClick`, иначе `<div>`. Список
 * снаружи оборачивают в `<ListGroup>` — он даёт `divide-y`.
 */
export const ListRow = React.forwardRef<HTMLElement, ListRowProps>(
  ({ leading, title, subtitle, trailing, onClick, active = false, href, disabled, className, ...rest }, ref) => {
    const interactive = Boolean(href || onClick) && !disabled;
    const classes = cn(
      "relative flex w-full min-h-12 items-center gap-3 px-3 py-2 text-left text-sm transition-colors",
      interactive && "cursor-pointer hover:bg-accent focus-visible:outline-none focus-visible:bg-accent",
      // Полоска — псевдоэлементом, а не border-l: рамка сдвигала бы контент
      // на 2px относительно соседних строк.
      active && "bg-primary/[0.06] before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-primary",
      disabled && "pointer-events-none opacity-50",
      className
    );
    const content = (
      <>
        {leading && <span className="flex shrink-0 items-center justify-center text-muted-foreground">{leading}</span>}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={cn("truncate text-[13px] leading-5", active ? "text-primary" : "text-foreground")}>{title}</span>
          {subtitle && <span className="truncate text-[12px] leading-4 text-muted-foreground">{subtitle}</span>}
        </span>
        {trailing && <span className="flex shrink-0 items-center gap-2 text-[12px] text-muted-foreground">{trailing}</span>}
      </>
    );

    if (href && !disabled) {
      return (
        <Link
          ref={ref as React.Ref<HTMLAnchorElement>}
          to={href}
          onClick={onClick as React.MouseEventHandler<HTMLAnchorElement> | undefined}
          aria-current={active ? "true" : undefined}
          className={classes}
          {...(rest as React.AnchorHTMLAttributes<HTMLAnchorElement>)}
        >
          {content}
        </Link>
      );
    }
    if (onClick) {
      return (
        <button
          ref={ref as React.Ref<HTMLButtonElement>}
          type="button"
          onClick={onClick}
          disabled={disabled}
          aria-pressed={active || undefined}
          className={classes}
          {...(rest as React.ButtonHTMLAttributes<HTMLButtonElement>)}
        >
          {content}
        </button>
      );
    }
    return (
      <div ref={ref as React.Ref<HTMLDivElement>} className={classes} {...rest}>
        {content}
      </div>
    );
  }
);
ListRow.displayName = "ListRow";

/** Обёртка списка строк: разделители между строками и обрезка подсветки по скруглению. */
export const ListGroup = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} role="list" className={cn("flex flex-col divide-y divide-border overflow-hidden", className)} {...props} />
  )
);
ListGroup.displayName = "ListGroup";
