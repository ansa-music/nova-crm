const MESSAGES: Record<string, string> = {
  "auth/invalid-email": "Некорректный email",
  "auth/user-disabled": "Аккаунт отключён",
  "auth/user-not-found": "Пользователь не найден",
  "auth/wrong-password": "Неверный пароль",
  "auth/invalid-credential": "Неверный email или пароль",
  "auth/email-already-in-use": "Этот email уже зарегистрирован",
  "auth/weak-password": "Пароль слишком простой",
  "auth/popup-closed-by-user": "Окно входа было закрыто",
  "auth/cancelled-popup-request": "Повторный вход уже выполняется",
  "auth/redirect-cancelled-by-user": "Вход через Google отменён",
  "auth/popup-blocked": "Браузер заблокировал окно входа — разрешите всплывающие окна",
  "auth/network-request-failed": "Проблема с сетью, попробуйте снова",
  "auth/too-many-requests": "Слишком много попыток, попробуйте позже",
};

export function getAuthErrorMessage(error: unknown): string {
  const code = (error as { code?: string })?.code;
  if (code && MESSAGES[code]) return MESSAGES[code];
  if (error instanceof Error) return error.message;
  return "Что-то пошло не так, попробуйте ещё раз";
}
