import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/utils/cn";

/**
 * Кнопка темы «один акцент, плоско». Свечение при наведении (`hover:shadow`
 * с бирюзой) убрано вместе с остальным неоном: единственная акцентная —
 * `default`, остальные нейтральные и различаются только заливкой/рамкой.
 * Вариант `glass` удалён — вызовов не было (grep по `variant="glass"`).
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium select-none touch-manipulation transition-[color,background-color,border-color,opacity] duration-200 ease-out active:translate-y-px motion-reduce:transition-colors motion-reduce:active:translate-y-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 disabled:active:translate-y-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90 active:bg-destructive/80",
        outline: "border border-border bg-transparent text-foreground hover:bg-accent active:bg-accent/70",
        secondary: "bg-muted text-foreground hover:bg-accent active:bg-accent/70",
        ghost: "text-foreground hover:bg-accent active:bg-accent/70",
        link: "text-primary underline-offset-4 hover:underline active:translate-y-0",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 px-3 text-xs",
        lg: "h-11 px-6 text-base",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";

    return (
      <Comp
        ref={ref}
        // `data-size` читает тач-блок index.css: на телефоне `button[data-size="icon"]`
        // дорастает до 44×44 без правки каждого из ~45 вызовов.
        data-size={size ?? "default"}
        className={cn(buttonVariants({ variant, size, className }))}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";
