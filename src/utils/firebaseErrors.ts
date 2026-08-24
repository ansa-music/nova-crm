const POPUP_CODES = new Set([
  "auth/popup-closed-by-user",
  "auth/cancelled-popup-request",
  "auth/popup-blocked",
  "auth/redirect-cancelled-by-user",
  "auth/redirect-operation-pending",
  "auth/no-auth-event",
]);

const MESSAGES: Record<string, string> = {
  "auth/invalid-email": "Некорректный email",
  "auth/user-disabled": "Аккаунт отключён",
  "auth/user-not-found": "Пользователь не найден",
  "auth/wrong-password": "Неверный пароль",
  "auth/invalid-credential": "Неверный email или пароль",
  "auth/invalid-login-credentials": "Неверный email или пароль",
  "auth/missing-password": "Введите пароль",
  "auth/email-already-in-use": "Этот email уже зарегистрирован",
  "auth/weak-password": "Пароль слишком простой",
  "auth/popup-closed-by-user": "Окно входа было закрыто",
  "auth/cancelled-popup-request": "Повторный вход уже выполняется",
  "auth/redirect-cancelled-by-user": "Вход через Google отменён",
  "auth/popup-blocked": "Браузер заблокировал окно входа — разрешите всплывающие окна",
  "auth/network-request-failed": "Проблема с сетью, попробуйте снова",
  "auth/too-many-requests": "Слишком много попыток, попробуйте позже",
  "auth/unauthorized-domain": "Этот адрес сайта не разрешён для входа. Откройте https://nurba-6e70d.web.app/login",
  "auth/operation-not-allowed": "Этот способ входа отключён. Попробуйте другой.",
  "auth/account-exists-with-different-credential": "Этот email уже используется через Google. Нажмите «Продолжить с Google».",
  "auth/web-storage-unsupported": "Браузер заблокировал сохранение сессии. Отключите приватный режим и попробуйте снова.",
};

function errorCode(error: unknown): string | undefined {
  return (error as { code?: string })?.code;
}

export function getAuthErrorMessage(error: unknown): string {
  const code = errorCode(error);
  if (code && MESSAGES[code]) return MESSAGES[code];
  if (error instanceof Error && error.message) return error.message;
  return "Что-то пошло не так, попробуйте ещё раз";
}

/** Email/password must never surface Google popup/redirect copy like «окно закрыто». */
export function getEmailAuthErrorMessage(error: unknown): string {
  const code = errorCode(error);
  if (code && POPUP_CODES.has(code)) {
    return "Не удалось войти по email. Подождите секунду и попробуйте снова, либо войдите через Google.";
  }
  if (code === "auth/account-exists-with-different-credential") {
    return "Этот email зарегистрирован через Google. Нажмите «Продолжить с Google».";
  }
  if (code && MESSAGES[code]) return MESSAGES[code];
  if (error instanceof Error && error.message) return error.message;
  return "Не удалось войти. Проверьте email и пароль.";
}
