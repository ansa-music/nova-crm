import { Link } from "react-router";
import { BrandMark } from "@/components/common/BrandMark";
import { Button } from "@/components/ui/button";

export default function NotFoundPage() {
  return (
    <div className="page-surface relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-12">
      <div className="relative z-10 w-full max-w-[420px] rounded-lg border border-border/80 bg-card/80 p-7 text-center sm:p-8">
        <BrandMark className="mb-8 w-full justify-center" />
        <p className="eyebrow mb-3">Ошибка 404</p>
        <h1 className="display text-[2.1rem] leading-[1.15]">Страница не найдена</h1>
        <p className="mt-3 text-[15px] leading-6 text-foreground/70">
          Такого адреса нет в архиве — вернитесь на главную и продолжите работу.
        </p>
        <Button asChild className="mt-8 h-10 w-full">
          <Link to="/">На главную</Link>
        </Button>
      </div>
    </div>
  );
}
