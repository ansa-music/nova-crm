import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { KeyRound, Loader2, QrCode, Smartphone } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  cancelLogin,
  sendPhoneCode,
  startQrLogin,
  submitPassword,
  submitPhoneCode,
  tgErrorText,
  type TgAuth,
  type TgEnded,
} from "@/services/telegram/tgClient";
import { TgEndedNote } from "@/components/telegram/TgConnection";

/**
 * Вход в рабочий аккаунт Telegram — один раз на браузер. QR-код сканируют
 * телефоном, где аккаунт уже открыт (Telegram → Настройки → Устройства →
 * Подключить устройство), или код приходит в Telegram на тот же телефон.
 * Без телефона хозяина аккаунта войти нельзя.
 */
export function TgLogin({ auth, lastEnd = null }: { auth: TgAuth; lastEnd?: TgEnded | null }) {
  const [mode, setMode] = useState<"qr" | "phone">("qr");
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [phone, setPhone] = useState("+7");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const qrUrl = auth.kind === "qr" ? auth.url : null;
  useEffect(() => {
    if (!qrUrl) {
      setQrImage(null);
      return;
    }
    let alive = true;
    QRCode.toDataURL(qrUrl, { margin: 1, width: 240, errorCorrectionLevel: "M" })
      .then((img) => alive && setQrImage(img))
      .catch(() => alive && setQrImage(null));
    return () => {
      alive = false;
    };
  }, [qrUrl]);

  // «Показать QR-код» НЕ через run: вход по QR длится до самого конца, вместе
  // с облачным паролем, и общий busy запирал бы кнопку «Войти» у пароля
  // (жалоба Nurba 26.09.2026: «бесконечная загрузка»). Ошибки QR-входа
  // startQrLogin кладёт в состояние сам.
  function showQr() {
    setError(null);
    void startQrLogin();
  }

  async function run(fn: () => Promise<void>, fallback: string) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(tgErrorText(e, fallback));
    } finally {
      setBusy(false);
    }
  }

  if (auth.kind === "password") {
    return (
      <Card title="Облачный пароль" icon={<KeyRound className="h-5 w-5" />} text="На аккаунте включена двухэтапная проверка — введите облачный пароль Telegram.">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!password) return;
            void run(() => submitPassword(password), "Пароль не подошёл");
            setPassword("");
          }}
        >
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={auth.hint ? `Подсказка: ${auth.hint}` : "Пароль"} autoFocus />
          {(auth.error || error) && <p className="text-sm text-destructive">{auth.error || error}</p>}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || !password} className="gap-1.5">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Войти
            </Button>
            <Button type="button" variant="ghost" onClick={cancelLogin}>
              Отмена
            </Button>
          </div>
        </form>
      </Card>
    );
  }

  if (auth.kind === "code") {
    return (
      <Card title="Код из Telegram" icon={<Smartphone className="h-5 w-5" />} text={`Код отправлен ${auth.via || ""} на аккаунт ${auth.phone}. Он придёт сообщением от Telegram на телефоне хозяина.`}>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!code.trim()) return;
            void run(() => submitPhoneCode(code), "Код не подошёл");
          }}
        >
          <Input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="Код" inputMode="numeric" autoFocus className="font-mono text-lg tracking-widest" />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || !code.trim()} className="gap-1.5">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Войти
            </Button>
            <Button type="button" variant="ghost" onClick={cancelLogin}>
              Назад
            </Button>
          </div>
        </form>
      </Card>
    );
  }

  const qrActive = auth.kind === "qr" || auth.kind === "qrScanned";
  return (
    <Card
      title="Вход в рабочий Telegram"
      icon={<QrCode className="h-5 w-5" />}
      text="Один раз на этот браузер. Нужен телефон, где рабочий аккаунт уже открыт."
    >
      <TgEndedNote ended={lastEnd} />
      <div className="mb-4 inline-flex rounded-lg border border-border p-0.5">
        {(["qr", "phone"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              if (m === "phone") cancelLogin();
              setMode(m);
              setError(null);
            }}
            className={`h-9 rounded-md px-3 text-[13px] font-medium sm:h-8 ${mode === m ? "bg-primary/[0.12] text-primary" : "text-muted-foreground hover:text-foreground"}`}
          >
            {m === "qr" ? "QR-код" : "По номеру"}
          </button>
        ))}
      </div>

      {mode === "qr" ? (
        <div className="space-y-3">
          {auth.kind === "qrScanned" ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Код отсканирован, вхожу…
            </p>
          ) : qrActive && qrImage ? (
            <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
              <img src={qrImage} alt="QR-код для входа в Telegram" className="h-60 w-60 rounded-lg bg-white p-2" />
              <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
                <li>Откройте Telegram на телефоне с рабочим аккаунтом.</li>
                <li>Настройки → Устройства → Подключить устройство.</li>
                <li>Наведите камеру на этот код.</li>
              </ol>
            </div>
          ) : (
            <Button onClick={showQr} disabled={busy || qrActive} className="gap-1.5">
              {(busy || qrActive) && <Loader2 className="h-4 w-4 animate-spin" />} Показать QR-код
            </Button>
          )}
          {qrActive && auth.kind === "qr" && (
            <Button variant="ghost" size="sm" onClick={cancelLogin}>
              Отмена
            </Button>
          )}
        </div>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => sendPhoneCode(phone), "Код не отправился");
          }}
        >
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+7 700 000 00 00" inputMode="tel" autoComplete="off" />
          <Button type="submit" disabled={busy || phone.replace(/\D/g, "").length < 10} className="gap-1.5">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Получить код
          </Button>
        </form>
      )}

      {error && (
        <Alert tone="error" className="mt-3">
          {error}
        </Alert>
      )}
    </Card>
  );
}

function Card({ title, text, icon, children }: { title: string; text: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-xl p-4 sm:p-8">
      <div className="rounded-xl border border-border bg-card p-5 sm:p-6">
        <div className="mb-4 flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/[0.12] text-primary">{icon}</span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold">{title}</h2>
            <p className="mt-0.5 text-[13px] leading-5 text-muted-foreground">{text}</p>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
