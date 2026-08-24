import { useEffect, useRef, useState, type BaseSyntheticEvent } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { deskEase, gsap, useGSAP } from "@/lib/gsap";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import {
  loginSchema,
  signupSchema,
  type LoginFormValues,
  type SignupFormValues,
} from "@/utils/validation";
import {
  completeGoogleRedirectIfNeeded,
  getGoogleRedirectError,
  isIgnorableGoogleAuthError,
  shouldUseRedirectSignIn,
  signInWithEmail,
  signInWithGoogle,
  signUpWithEmail,
  wasGoogleRedirectPending,
} from "@/firebase/auth";
import { getAuthErrorMessage, getEmailAuthErrorMessage } from "@/utils/firebaseErrors";
import { isFirebaseConfigured } from "@/firebase/firebase";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4">
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29A11.96 11.96 0 000 12c0 1.94.46 3.77 1.29 5.38l3.98-3.09z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z"
      />
    </svg>
  );
}

const fieldClass =
  "h-10 rounded-sm border border-input bg-background px-3 font-sans tracking-normal placeholder:font-sans placeholder:text-muted-foreground";

function readFormValue(form: HTMLFormElement | undefined, name: string, fallback: string) {
  if (!form) return fallback;
  const raw = new FormData(form).get(name);
  return typeof raw === "string" && raw.length > 0 ? raw : fallback;
}

export function LoginForm() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(() => wasGoogleRedirectPending());
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const pending = wasGoogleRedirectPending();
    if (pending) setIsGoogleLoading(true);
    completeGoogleRedirectIfNeeded()
      .then(() => {
        if (cancelled) return;
        const redirectError = getGoogleRedirectError();
        // Only surface a real Google redirect failure. Never «окно закрыто».
        if (pending && redirectError && !isIgnorableGoogleAuthError(redirectError)) {
          const message = getAuthErrorMessage(redirectError);
          setFormError(message);
          toast.error(message);
        }
      })
      .finally(() => {
        if (!cancelled) setIsGoogleLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loginForm = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const signupForm = useForm<SignupFormValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: { name: "", email: "", password: "", confirmPassword: "" },
  });

  async function handleLogin(values: LoginFormValues, event?: BaseSyntheticEvent) {
    const form = event?.target instanceof HTMLFormElement ? event.target : undefined;
    const email = readFormValue(form, "email", values.email).trim();
    const password = readFormValue(form, "password", values.password);
    setIsSubmitting(true);
    setFormError(null);
    try {
      await signInWithEmail(email, password);
      toast.success("С возвращением!");
    } catch (error) {
      const message = getEmailAuthErrorMessage(error);
      setFormError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSignup(values: SignupFormValues, event?: BaseSyntheticEvent) {
    const form = event?.target instanceof HTMLFormElement ? event.target : undefined;
    const name = readFormValue(form, "name", values.name).trim();
    const email = readFormValue(form, "email", values.email).trim();
    const password = readFormValue(form, "password", values.password);
    setIsSubmitting(true);
    setFormError(null);
    try {
      await signUpWithEmail(email, password, name);
      toast.success("Аккаунт создан!");
    } catch (error) {
      const message = getEmailAuthErrorMessage(error);
      setFormError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleGoogle() {
    setIsGoogleLoading(true);
    setFormError(null);
    try {
      const user = await signInWithGoogle();
      if (!user && shouldUseRedirectSignIn()) {
        return;
      }
    } catch (error) {
      if (shouldUseRedirectSignIn() && isIgnorableGoogleAuthError(error)) {
        return;
      }
      const message = getAuthErrorMessage(error);
      setFormError(message);
      toast.error(message);
    } finally {
      if (!wasGoogleRedirectPending()) setIsGoogleLoading(false);
    }
  }

  const rootRef = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    if (!rootRef.current) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    gsap.fromTo(rootRef.current, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.36, ease: deskEase });
  }, { scope: rootRef });

  return (
    <div ref={rootRef} className="w-full">
      <h1 className="display text-[1.85rem] leading-[1.2] sm:text-[2rem]">
        {mode === "login" ? "Вход в архив" : "Создать аккаунт"}
      </h1>
      <p className="mt-3 text-[15px] leading-6 text-muted-foreground">
        {mode === "login"
          ? "Вернитесь к столу — клиенты, сделки и команда в одном архиве"
          : "Начните управлять командой и клиентами за пару минут"}
      </p>

      {!isFirebaseConfigured && (
        <div className="mt-6 rounded-sm border border-secondary/50 bg-secondary/10 p-3 text-xs text-foreground">
          Firebase не настроен. Заполните <code>.env.local</code> данными вашего проекта —
          подробности в README.
        </div>
      )}

      {formError && (
        <div className="mt-6 rounded-sm border border-secondary/50 bg-secondary/10 p-3 text-sm text-foreground">
          {formError}
        </div>
      )}

      <div className="mt-8 flex flex-col gap-4">
        <Button
          variant="outline"
          className="h-10 w-full"
          onClick={handleGoogle}
          disabled={isGoogleLoading || !isFirebaseConfigured}
        >
          {isGoogleLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <GoogleIcon />}
          Продолжить с Google
        </Button>

        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-border" />
          <span className="eyebrow">или через email</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        {mode === "login" ? (
          <form onSubmit={loginForm.handleSubmit(handleLogin)} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email" className="eyebrow text-muted-foreground">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="you@company.com"
                className={fieldClass}
                {...loginForm.register("email")}
              />
              {loginForm.formState.errors.email && (
                <p className="text-xs text-secondary">{loginForm.formState.errors.email.message}</p>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password" className="eyebrow text-muted-foreground">
                Пароль
              </Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                placeholder="Введите пароль"
                className={fieldClass}
                {...loginForm.register("password")}
              />
              {loginForm.formState.errors.password && (
                <p className="text-xs text-secondary">{loginForm.formState.errors.password.message}</p>
              )}
            </div>
            <Button type="submit" className="mt-1 h-10 w-full" disabled={isSubmitting || !isFirebaseConfigured}>
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Войти
            </Button>
          </form>
        ) : (
          <form onSubmit={signupForm.handleSubmit(handleSignup)} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="name" className="eyebrow text-muted-foreground">
                Имя
              </Label>
              <Input id="name" autoComplete="name" placeholder="Ваше имя" className={fieldClass} {...signupForm.register("name")} />
              {signupForm.formState.errors.name && (
                <p className="text-xs text-secondary">{signupForm.formState.errors.name.message}</p>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="signup-email" className="eyebrow text-muted-foreground">
                Email
              </Label>
              <Input
                id="signup-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="you@company.com"
                className={fieldClass}
                {...signupForm.register("email")}
              />
              {signupForm.formState.errors.email && (
                <p className="text-xs text-secondary">{signupForm.formState.errors.email.message}</p>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="signup-password" className="eyebrow text-muted-foreground">
                Пароль
              </Label>
              <Input
                id="signup-password"
                type="password"
                autoComplete="new-password"
                placeholder="Придумайте пароль"
                className={fieldClass}
                {...signupForm.register("password")}
              />
              {signupForm.formState.errors.password && (
                <p className="text-xs text-secondary">{signupForm.formState.errors.password.message}</p>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="confirm-password" className="eyebrow text-muted-foreground">
                Подтверждение
              </Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                placeholder="Повторите пароль"
                className={fieldClass}
                {...signupForm.register("confirmPassword")}
              />
              {signupForm.formState.errors.confirmPassword && (
                <p className="text-xs text-secondary">{signupForm.formState.errors.confirmPassword.message}</p>
              )}
            </div>
            <Button type="submit" className="mt-1 h-10 w-full" disabled={isSubmitting || !isFirebaseConfigured}>
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Создать аккаунт
            </Button>
          </form>
        )}
      </div>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        {mode === "login" ? "Ещё нет аккаунта?" : "Уже есть аккаунт?"}{" "}
        <button
          type="button"
          className="font-medium text-primary transition-colors hover:text-primary/80"
          onClick={() => {
            setFormError(null);
            setMode(mode === "login" ? "signup" : "login");
          }}
        >
          {mode === "login" ? "Создать аккаунт" : "Войти"}
        </button>
      </p>
    </div>
  );
}
