import { useSiteConfig } from "@/config/siteTerms";
import { cachedBrand } from "@/hooks/useSiteConfigBridge";
import { cn } from "@/utils/cn";

/**
 * Знак компании. Без «Конструктора сайта» — прежний NOVA. Внутри приложения
 * берётся настройка активного workspace; на экранах без него (вход, загрузка,
 * 404) — последний бренд, запомненный на этом устройстве.
 *
 * `variant`: «word» — логотип или название (широкое место), «mark» — логотип
 * или 1–3 знака (рейка меню).
 */
export function BrandMark({
  className,
  size = "md",
  variant = "word",
  useCache = false,
}: {
  className?: string;
  size?: "sm" | "md";
  variant?: "word" | "mark";
  /** Экран без workspace: взять запомненный бренд. */
  useCache?: boolean;
}) {
  const site = useSiteConfig();
  const cached = useCache && !site.brand ? cachedBrand() : null;
  const name = site.brand?.name ?? cached?.name;
  const mark = site.brand?.mark ?? cached?.mark;
  const logoUrl = site.brand?.logoUrl ?? cached?.logoUrl;
  const textSize = size === "sm" ? "text-lg" : "text-[22px]";

  if (logoUrl) {
    return (
      <span className={cn("inline-flex min-w-0 items-center gap-2", className)}>
        <img
          src={logoUrl}
          alt={name ?? "Логотип"}
          className={cn("shrink-0 object-contain", variant === "mark" ? "h-7 w-7" : size === "sm" ? "h-6 max-w-[120px]" : "h-7 max-w-[150px]")}
        />
        {variant === "word" && name ? (
          <span className={cn("truncate font-serif font-medium leading-none text-foreground", size === "sm" ? "text-base" : "text-lg")}>{name}</span>
        ) : null}
      </span>
    );
  }
  if (variant === "mark") {
    const text = mark || (name ? name.charAt(0).toUpperCase() : "N");
    return <span className={cn("font-serif text-[18px] font-medium leading-none", className)}>{text}</span>;
  }
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2", className)}>
      <span className={cn("wordmark truncate leading-none", textSize)}>{name ?? "NOVA"}</span>
    </span>
  );
}
