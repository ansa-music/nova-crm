import { cn } from "@/utils/cn";

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("skeleton rounded-md", className)} {...props} />;
}
