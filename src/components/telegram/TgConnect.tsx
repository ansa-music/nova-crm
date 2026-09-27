import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { KeyRound, Link2, Loader2, QrCode, ShieldCheck, Smartphone } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { callTgEdge, refreshTgServer, ringTgServer, TgEdgeError } from "@/services/telegram/tgServer";

type Step =
  | { kind: "idle" }
  | { kind: "qr"; url: string }
  | { kind: "code"; via: string }
  | { kind: "password"; hint: string | null }
  | { kind: "done" };

interface Props {
  workspaceId: string;
  /** Этот браузер уже вошёл по-старому — он сам подтвердит вход сервера, без QR. */
  migrate?: ((url: string) => Promise<void>) | null;
  /** Войти по-старому, только в этом браузере (если сервер недоступен). */
  onLegacy?: (() => void) | null;
}

function errText(error: unknown, fallback: string) {
  if (error instanceof TgEdgeError) return error.message;
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * Подключить Telegram к workspace — один раз (просьба Nurba 27.09.2026:
 * «только 1 аккаунт, один раз зашёл — и всё»). Вход живёт на сервере
 * (функция `tg`), от него браузеры получают свои устройства сами.
 */
export function TgConnect({ workspaceId, migrate = null, onLegacy = null }: Props) {
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [mode, setMode] = useState<"qr" | "phone">("qr");
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [phone, setPhone] = useState("+7");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    []
  );

  const url = step.kind === "qr" ? step.url : null;
  useEffect(() => {
    if (!url) {
      setQrImage(null);
      return;
    }
    let on = true;
    QRCode.toDataURL(url, { margin: 1, width: 240, errorCorrectionLevel: "M" })
      .then((img) => on && setQrImage(img))
      .catch(() => on && setQrImage(null));
    return () => {
      on = false;
    };
  }, [url]);

  function apply(res: Record<string, unknown>) {
    if (res.state === "connected") {
      setStep({ kind: "done" });
      ringTgServer(workspaceId);
      refreshTgServer();
      return;
    }
    if (res.state === "qr") setStep({ kind: "qr", url: String(res.url) });
    else if (res.state === "password") setStep({ kind: "password", hint: (res.hint as string) ?? null });
    else if (res.state === "code") setStep({ kind: "code", via: String(res.via ?? "") });
  }

  // Пока показан QR — спрашиваем сервер раз в 2 с, отсканировали ли.
  useEffect(() => {
    if (step.kind !== "qr") return;
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      if (document.visibilityState === "visible") {
        try {
          const res = await callTgEdge(workspaceId, "connect_qr_poll");
          if (!stopped && alive.current) apply(res);
          if (res.state !== "qr") return;
        } catch (e) {
          if (!stopped) setError(errText(e, "Сервер Telegram не ответил"));
        }
      }
      if (!stopped) setTimeout(tick, 2000);
    };
    const timer = setTimeout(tick, 2000);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.kind, workspaceId]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errText(e, "Не удалось"));
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  const startQr = (viaThisBrowser: boolean) =>
    run(async () => {
      const res = await callTgEdge(workspaceId, "connect_qr_start");
      if (viaThisBrowser && migrate && res.state === "qr") {
        await migrate(String(res.url));
        const next = await callTgEdge(workspaceId, "connect_qr_poll");
        apply(next);
        return;
      }
      apply(res);
    });

  if (step.kind === "done") {
    return (
      <Alert tone="success" title="Telegram подключён к workspace">
        Теперь он работает у всех, кому открыт раздел, и больше не вылетает: вход хранится на сервере.
      </Alert>
    );
  }

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-500/15 text-sky-300">
          <ShieldCheck className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-semibold">Подключить Telegram к workspace</h2>
          <p className="text-[13px] text-muted-foreground">
            Один раз — и аккаунт остаётся подключённым, даже когда сайт закрыт или ноутбук выключен. Остальным браузерам вход выдаётся сам,
            QR им не нужен. В workspace может быть только один аккаунт Telegram.
          </p>
        </div>
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      {step.kind === "password" ? (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!password) return;
            void run(async () => {
              const res = await callTgEdge(workspaceId, "connect_password", { password, remember });
              setPassword("");
              apply(res);
            });
          }}
        >
          <p className="flex items-center gap-2 text-[13px]">
            <KeyRound className="h-4 w-4 text-primary" /> Облачный пароль Telegram{step.hint ? ` (подсказка: ${step.hint})` : ""}
          </p>
          <Input type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Облачный пароль" aria-label="Облачный пароль" />
          <label className="flex items-start gap-2 text-[12px] text-muted-foreground">
            <input type="checkbox" className="mt-0.5" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            <span>Запомнить пароль на сервере — новые устройства будут входить сами. Без этого пароль спросят один раз в каждом браузере.</span>
          </label>
          <Button type="submit" disabled={busy || !password} className="min-h-11 sm:min-h-9">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Подключить
          </Button>
        </form>
      ) : step.kind === "code" ? (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => apply(await callTgEdge(workspaceId, "connect_phone_code", { code })));
          }}
        >
          <p className="text-[13px]">Код отправлен {step.via || "в Telegram"}.</p>
          <Input autoFocus inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Код" aria-label="Код" />
          <Button type="submit" disabled={busy || !code.trim()} className="min-h-11 sm:min-h-9">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Войти
          </Button>
        </form>
      ) : step.kind === "qr" ? (
        <div className="flex flex-col items-center gap-3 text-center">
          {qrImage ? <img src={qrImage} alt="QR-код входа в Telegram" className="h-60 w-60 rounded-lg bg-white p-2" /> : <Loader2 className="h-6 w-6 animate-spin" />}
          <p className="text-[13px] text-muted-foreground">
            На телефоне с рабочим аккаунтом: Telegram → Настройки → Устройства → Подключить устройство — и наведите камеру на код.
          </p>
          <Button variant="ghost" size="sm" onClick={() => void callTgEdge(workspaceId, "connect_cancel").finally(() => setStep({ kind: "idle" }))}>
            Отмена
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {migrate && (
            <Button className="min-h-11 w-full gap-2 sm:min-h-9 sm:w-auto" disabled={busy} onClick={() => void startQr(true)}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
              Сделать этот вход общим для workspace
            </Button>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant={mode === "qr" ? "default" : "outline"} size="sm" className="min-h-11 gap-1.5 sm:min-h-8" onClick={() => setMode("qr")}>
              <QrCode className="h-4 w-4" /> QR-код
            </Button>
            <Button variant={mode === "phone" ? "default" : "outline"} size="sm" className="min-h-11 gap-1.5 sm:min-h-8" onClick={() => setMode("phone")}>
              <Smartphone className="h-4 w-4" /> По номеру
            </Button>
          </div>
          {mode === "qr" ? (
            <Button variant="outline" disabled={busy} className="min-h-11 sm:min-h-9" onClick={() => void startQr(false)}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Показать QR-код
            </Button>
          ) : (
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => apply(await callTgEdge(workspaceId, "connect_phone_send", { phone })));
              }}
            >
              <Input className="max-w-xs" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} aria-label="Номер телефона" />
              <Button type="submit" disabled={busy} className="min-h-11 sm:min-h-9">
                {busy && <Loader2 className="h-4 w-4 animate-spin" />} Получить код
              </Button>
            </form>
          )}
          {onLegacy && (
            <button type="button" className="text-[12px] text-muted-foreground underline-offset-2 hover:underline" onClick={onLegacy}>
              Войти по-старому — только в этом браузере
            </button>
          )}
        </div>
      )}
    </div>
  );
}
