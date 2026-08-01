import { Link } from "react-router";
import { Button } from "@/components/ui/button";

export default function NotFoundPage() {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-3 bg-background text-center">
      <p className="text-5xl font-semibold tracking-tight">404</p>
      <p className="text-muted-foreground">Страница не найдена</p>
      <Button asChild>
        <Link to="/">На главную</Link>
      </Button>
    </div>
  );
}
