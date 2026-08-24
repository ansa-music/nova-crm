import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/utils/cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium select-none touch-manipulation transition-[color,background-color,box-shadow,transform,opacity] duration-200 ease-out active:translate-y-px active:scale-[0.97] motion-reduce:transition-colors motion-reduce:active:translate-y-0 motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:shadow-[0_0_0_1px_hsl(var(--primary)/0.7),0_0_22px_hsl(var(--primary)/0.4)] disabled:pointer-events-none disabled:opacity-50 disabled:active:translate-y-0 disabled:active:scale-100",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-[0_0_18px_hsl(var(--primary)/0.45),0_0_40px_hsl(var(--primary)/0.18)] hover:bg-primary/80 hover:shadow-[0_0_28px_hsl(var(--primary)/0.62),0_0_56px_hsl(var(--primary)/0.28)]",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/80",
        outline: "border border-border bg-transparent hover:border-primary/55 hover:bg-primary/10 hover:text-primary",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/70",
        ghost: "hover:bg-accent hover:text-accent-foreground hover:shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.14)]",
        link: "text-primary underline-offset-4 hover:underline active:scale-100 active:translate-y-0",
        glass: "glass text-foreground hover:bg-white/95 dark:hover:bg-white/[0.12]",
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
      <Comp ref={ref} className={cn(buttonVariants({ variant, size, className }))} {...props} />
    );
  }
);
Button.displayName = "Button";
