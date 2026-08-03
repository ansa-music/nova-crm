import { Component, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("Unhandled render error:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-screen flex-col items-center justify-center gap-4 bg-background px-4 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Что-то пошло не так</h1>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Произошла непредвиденная ошибка. Попробуйте обновить страницу — если проблема
              повторится, сообщите об этом.
            </p>
          </div>
          <Button onClick={() => window.location.reload()}>Обновить страницу</Button>
        </div>
      );
    }
    return this.props.children;
  }
}
