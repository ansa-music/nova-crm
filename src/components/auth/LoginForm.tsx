import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { motion } from "framer-motion";
import { Loader2, Lock, Mail, User } from "lucide-react";
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
import { signInWithEmail, signInWithGoogle, signUpWithEmail } from "@/firebase/auth";
import { getAuthErrorMessage } from "@/utils/firebaseErrors";
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

export function LoginForm() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);

  const loginForm = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const signupForm = useForm<SignupFormValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: { name: "", email: "", password: "", confirmPassword: "" },
  });

  async function handleLogin(values: LoginFormValues) {
    setIsSubmitting(true);
    try {
      await signInWithEmail(values.email, values.password);
      toast.success("С возвращением!");
    } catch (error) {
      toast.error(getAuthErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSignup(values: SignupFormValues) {
    setIsSubmitting(true);
    try {
      await signUpWithEmail(values.email, values.password, values.name);
      toast.success("Аккаунт создан!");
    } catch (error) {
      toast.error(getAuthErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleGoogle() {
    setIsGoogleLoading(true);
    try {
      await signInWithGoogle();
    } catch (error) {
      toast.error(getAuthErrorMessage(error));
    } finally {
      setIsGoogleLoading(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="w-full max-w-sm"
    >
      <div className="glass rounded-2xl p-8 shadow-glow">
        <div className="mb-7 flex flex-col items-center text-center">
          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-purple-500 shadow-glow">
            <svg viewBox="0 0 32 32" className="h-6 w-6" fill="none">
              <path
                d="M9 21V11l7 7 7-7v10"
                stroke="white"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <h1 className="text-xl font-semibold tracking-tight">
            {mode === "login" ? "С возвращением" : "Создайте аккаунт"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === "login"
              ? "Войдите, чтобы продолжить работу в Nova CRM"
              : "Начните управлять командой и клиентами за пару минут"}
          </p>
        </div>

        {!isFirebaseConfigured && (
          <div className="mb-5 rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-warning-foreground">
            Firebase не настроен. Заполните <code>.env.local</code> данными вашего проекта —
            подробности в README.
          </div>
        )}

        <Button
          variant="glass"
          className="mb-4 w-full"
          onClick={handleGoogle}
          disabled={isGoogleLoading || !isFirebaseConfigured}
        >
          {isGoogleLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <GoogleIcon />
          )}
          Продолжить с Google
        </Button>

        <div className="mb-4 flex items-center gap-3">
          <div className="h-px flex-1 bg-border" />
          <span className="text-xs text-muted-foreground">или через email</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        {mode === "login" ? (
          <form onSubmit={loginForm.handleSubmit(handleLogin)} className="flex flex-col gap-3.5">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input id="email" type="email" placeholder="you@company.com" className="pl-9" {...loginForm.register("email")} />
              </div>
              {loginForm.formState.errors.email && (
                <p className="text-xs text-destructive">{loginForm.formState.errors.email.message}</p>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">Пароль</Label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input id="password" type="password" placeholder="••••••••" className="pl-9" {...loginForm.register("password")} />
              </div>
              {loginForm.formState.errors.password && (
                <p className="text-xs text-destructive">{loginForm.formState.errors.password.message}</p>
              )}
            </div>
            <Button type="submit" className="mt-1 w-full" disabled={isSubmitting || !isFirebaseConfigured}>
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Войти
            </Button>
          </form>
        ) : (
          <form onSubmit={signupForm.handleSubmit(handleSignup)} className="flex flex-col gap-3.5">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="name">Имя</Label>
              <div className="relative">
                <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input id="name" placeholder="Ваше имя" className="pl-9" {...signupForm.register("name")} />
              </div>
              {signupForm.formState.errors.name && (
                <p className="text-xs text-destructive">{signupForm.formState.errors.name.message}</p>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="signup-email">Email</Label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input id="signup-email" type="email" placeholder="you@company.com" className="pl-9" {...signupForm.register("email")} />
              </div>
              {signupForm.formState.errors.email && (
                <p className="text-xs text-destructive">{signupForm.formState.errors.email.message}</p>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="signup-password">Пароль</Label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input id="signup-password" type="password" placeholder="••••••••" className="pl-9" {...signupForm.register("password")} />
              </div>
              {signupForm.formState.errors.password && (
                <p className="text-xs text-destructive">{signupForm.formState.errors.password.message}</p>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="confirm-password">Подтвердите пароль</Label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input id="confirm-password" type="password" placeholder="••••••••" className="pl-9" {...signupForm.register("confirmPassword")} />
              </div>
              {signupForm.formState.errors.confirmPassword && (
                <p className="text-xs text-destructive">{signupForm.formState.errors.confirmPassword.message}</p>
              )}
            </div>
            <Button type="submit" className="mt-1 w-full" disabled={isSubmitting || !isFirebaseConfigured}>
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Создать аккаунт
            </Button>
          </form>
        )}

        <p className="mt-5 text-center text-sm text-muted-foreground">
          {mode === "login" ? "Ещё нет аккаунта?" : "Уже есть аккаунт?"}{" "}
          <button
            type="button"
            className="font-medium text-primary hover:underline"
            onClick={() => setMode(mode === "login" ? "signup" : "login")}
          >
            {mode === "login" ? "Создать аккаунт" : "Войти"}
          </button>
        </p>
      </div>
    </motion.div>
  );
}
