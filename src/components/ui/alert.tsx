import * as React from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, Info, type LucideIcon } from "lucide-react";
import { cn } from "@/utils/cn";

export type AlertTone = "error" | "warning" | "info" | "success";

/* Полные строки — Tailwind не соберёт `border-${tone}/40` из шаблона. */
const TONE: Record<AlertTone, { box: string; icon: LucideIcon }> = {
  error: { box: "border-destructive/40 bg-destructive/10 text-foreground [&_svg]:text-destructive", icon: AlertCircle },
  warning: { box: "border-warning/40 bg-warning/10 text-foreground [&_svg]:text-warning", icon: AlertTriangle },
  info: { box: "border-primary/40 bg-primary/10 text-foreground [&_svg]:text-primary", icon: Info },
  success: { box: "border-success/40 bg-success/10 text-foreground [&_svg]:text-success", icon: CheckCircle2 },
};

export interface AlertProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  tone?: AlertTone;
  /** Жирная первая строка; `children` — пояснение под ней. */
  title?: React.ReactNode;
  /** Кнопка справа — «Повторить», «Открыть». */
  action?: React.ReactNode;
  /** Своя иконка вместо иконки тона. `null` — без иконки. */
  icon?: React.ReactNode | null;
}

/**
 * Встроенное уведомление в потоке страницы: ошибка загрузки, предупреждение
 * о квоте, подсказка. Тонированная плашка с рамкой в тоне и иконкой lucide,
 * `role="alert"` только у ошибок и предупреждений — остальное читалке
 * перебивать незачем.
 */
export const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  ({ tone = "info", title, action, icon, className, children, ...rest }, ref) => {
    const t = TONE[tone];
    const Icon = t.icon;
    const role = tone === "error" || tone === "warning" ? "alert" : "status";
    return (
      <div
        ref={ref}
        role={role}
        className={cn("flex items-start gap-2.5 rounded-lg border px-3 py-2 text-sm", t.box, className)}
        {...rest}
      >
        {icon === null ? null : (
          <span className="mt-0.5 shrink-0">{icon ?? <Icon className="h-4 w-4" aria-hidden />}</span>
        )}
        <div className="min-w-0 flex-1">
          {title && <p className="font-medium leading-5">{title}</p>}
          {children && <div className={cn("leading-5 text-muted-foreground", title && "mt-0.5")}>{children}</div>}
        </div>
        {action && <div className="ml-auto flex shrink-0 items-center gap-2 self-center">{action}</div>}
      </div>
    );
  }
);
Alert.displayName = "Alert";
