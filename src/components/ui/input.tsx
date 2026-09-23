import * as React from "react";
import { cn } from "@/utils/cn";

/**
 * Поле ввода — нейтральная рамка на фоне страницы, фокус обозначает сама
 * рамка плюс кольцо в 1px акцентом. Свечения (`shadow` бирюзой) нет: поле и так
 * единственное акцентное место в форме, пока в нём курсор.
 * 16px на таче (против зума iOS) даёт не класс, а правило в index.css — оно
 * же ловит «голые» <input> поиска, так что поведение у всех полей одно.
 */
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        "flex h-9 w-full rounded-lg border border-border bg-background px-3 py-1 text-sm transition-[border-color,box-shadow] duration-200 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
);
Input.displayName = "Input";
