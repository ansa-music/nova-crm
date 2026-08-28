import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/utils/cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium select-none touch-manipulation transition-[color,background-color,box-shadow,transform,opacity] duration-200 ease-out active:translate-y-px active:scale-[0.97] motion-reduce:transition-colors motion-reduce:active:translate-y-0 motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 disabled:active:translate-y-0 disabled:active:scale-100",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary/90 hover:shadow-[0_0_15px_hsl(var(--primary)/0.35)] active:bg-primary/80",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90 active:bg-destructive/80",
        outline:
          "border border-primary/20 bg-transparent text-primary hover:border-primary/50 hover:bg-primary/10 hover:text-primary active:bg-primary/16",
        secondary: "border border-primary/30 bg-primary/10 text-primary hover:bg-primary/16 active:bg-primary/22",
        ghost: "text-foreground hover:bg-primary/10 hover:text-primary active:bg-primary/16",
        link: "text-primary underline-offset-4 hover:underline active:scale-100 active:translate-y-0",
        glass:
          "border border-primary/[0.12] bg-white/[0.04] backdrop-blur-[20px] text-foreground hover:border-primary/40 hover:shadow-[0_0_15px_hsl(var(--primary)/0.12)]",
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
        className={cn(buttonVariants({ variant, size, className }))}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";
