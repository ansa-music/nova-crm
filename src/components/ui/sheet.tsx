import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";
import { cn } from "@/utils/cn";

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;
export const SheetPortal = DialogPrimitive.Portal;

export const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-[200] bg-black/60 pointer-events-auto data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 duration-280",
      className
    )}
    {...props}
  />
));
SheetOverlay.displayName = "SheetOverlay";

/**
 * Три стороны шторки. `left` — мобильный drawer навигации (фон страницы, чтобы
 * сливался с сайдбаром). `right` — боковые панели (чат, история, доступ).
 * `bottom` — телефонная панель «Ещё» и прочие списки действий: не выше 85dvh,
 * скругление только сверху, нижний отступ учитывает safe-area, вверху — ручка.
 */
const sheetVariants = cva("fixed gap-4 border-border pointer-events-auto overscroll-contain", {
  variants: {
    side: {
      left:
        "left-0 top-0 z-[210] h-[100dvh] max-h-[100dvh] w-[min(18rem,85vw)] max-w-[18rem] overflow-y-auto border-r bg-background p-5 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left data-[state=closed]:duration-240 data-[state=open]:duration-300",
      right:
        "right-0 top-0 bottom-0 z-[210] h-auto w-[min(24rem,85vw)] max-w-md border-l bg-popover p-5 shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right data-[state=closed]:duration-240 data-[state=open]:duration-300",
      bottom:
        "inset-x-0 bottom-0 z-[210] max-h-[85dvh] overflow-y-auto rounded-t-2xl border-t bg-background p-4 pb-[max(env(safe-area-inset-bottom),1rem)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom data-[state=closed]:duration-240 data-[state=open]:duration-300",
    },
  },
  defaultVariants: { side: "left" },
});

interface SheetContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>,
    VariantProps<typeof sheetVariants> {
  /** Скрыть крестик — когда у панели своя кнопка закрытия в шапке. */
  hideClose?: boolean;
}

export const SheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  SheetContentProps
>(({ side = "left", className, children, hideClose = false, ...props }, ref) => (
  <SheetPortal>
    <SheetOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(sheetVariants({ side }), className)}
      onCloseAutoFocus={(e) => e.preventDefault()}
      {...props}
    >
      {/* Ручка нижней шторки: подсказывает, что панель можно смахнуть, и
          отделяет её от контента под ней — рамки сверху для этого мало. */}
      {side === "bottom" && (
        <div aria-hidden className="mx-auto -mt-1 mb-3 h-1 w-9 shrink-0 rounded-sm bg-foreground/20" />
      )}
      {children}
      {!hideClose && (
        <DialogPrimitive.Close className="absolute right-2 top-2 z-20 flex h-11 w-11 items-center justify-center rounded-md opacity-60 transition-opacity hover:opacity-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:right-4 sm:top-4 sm:h-auto sm:w-auto">
          <X className="h-4 w-4" />
          <span className="sr-only">Закрыть</span>
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </SheetPortal>
));
SheetContent.displayName = "SheetContent";

export const SheetHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col gap-1.5", className)} {...props} />
);

export const SheetTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={cn("text-base font-medium tracking-[-0.02em]", className)} {...props} />
));
SheetTitle.displayName = "SheetTitle";

export const SheetDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
));
SheetDescription.displayName = "SheetDescription";
