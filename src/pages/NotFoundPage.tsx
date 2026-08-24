import { Link } from "react-router";
import { BrandMark } from "@/components/common/BrandMark";
import { Button } from "@/components/ui/button";

export default function NotFoundPage() {
  return (
    <div className="cyber-grid relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-12">
      <div className="relative z-10 w-full max-w-[420px] hud-frame rounded-md border border-primary/40 bg-card/95 p-7 text-center sm:p-8">
        <BrandMark className="mb-8 w-full justify-center" />
        <p className="eyebrow mb-3">Ошибка 404</p>
        <h1 className="display text-[2.1rem] leading-[1.15]">Страница не найдена</h1>
        <p className="mt-3 text-[15px] leading-6 text-muted-foreground">
          Такого адреса нет в архиве — вернитесь на главную и продолжите работу.
        </p>
        <Button asChild className="mt-8 h-10 w-full">
          <Link to="/">На главную</Link>
        </Button>
      </div>
    </div>
  );
}
