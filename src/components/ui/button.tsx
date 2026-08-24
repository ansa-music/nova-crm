import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/utils/cn";
import { useMagnetic } from "@/hooks/useMagnetic";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-sm text-sm font-medium select-none touch-manipulation transition-[color,background-color,box-shadow,transform,opacity] duration-200 ease-out active:translate-y-px active:scale-[0.97] motion-reduce:transition-colors motion-reduce:active:translate-y-0 motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:shadow-[0_0_0_1px_hsl(var(--primary)/0.7),0_0_18px_hsl(var(--primary)/0.4)] disabled:pointer-events-none disabled:opacity-50 disabled:active:translate-y-0 disabled:active:scale-100",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-[0_0_16px_hsl(var(--primary)/0.5),0_0_32px_hsl(var(--primary)/0.2)] hover:bg-primary/85 hover:shadow-[0_0_24px_hsl(var(--primary)/0.65),0_0_48px_hsl(var(--primary)/0.28)]",
        destructive: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        outline: "border border-primary/40 bg-transparent hover:border-primary hover:bg-primary/10 hover:text-primary",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground hover:shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.2)]",
        link: "text-primary underline-offset-4 hover:underline active:scale-100 active:translate-y-0",
        glass: "glass text-foreground hover:border-primary/60",
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
    const magneticRef = useMagnetic<HTMLButtonElement>();
    const magnetic = variant === "default" || variant === "outline" || variant == null;

    return (
      <Comp
        ref={(node) => {
          const el = node as HTMLButtonElement | null;
          if (magnetic) magneticRef.current = el;
          if (typeof ref === "function") ref(el);
          else if (ref) ref.current = el;
        }}
        className={cn(buttonVariants({ variant, size, className }))}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";
