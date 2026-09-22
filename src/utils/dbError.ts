/**
 * Человеческий текст ошибки базы — и её КОД рядом.
 *
 * Firestore говорит по-английски («Missing or insufficient permissions.»),
 * а наши собственные throw'ы — по-русски и по делу. Здесь первые
 * переводятся, вторые остаются как есть, и к переводу добавляется код: без
 * него «не удалось» в трёх разных случаях выглядит одинаково, и понять, что
 * именно сломалось — прав нет, связи нет или список разъехался, — нельзя ни
 * человеку, ни тому, кто будет чинить.
 */
const CODE_TEXT: Record<string, string> = {
  "permission-denied": "База отклонила запись: не хватает прав. Обновите страницу — возможно, роль или доступ изменились.",
  unauthenticated: "Вы не вошли в аккаунт — обновите страницу и войдите заново.",
  unavailable: "База не отвечает — похоже, пропала связь. Попробуйте ещё раз.",
  "deadline-exceeded": "База не успела ответить — попробуйте ещё раз.",
  aborted: "Данные только что изменились — попробуйте ещё раз.",
  "failed-precondition": "База отклонила запрос: данные изменились или не хватает индекса.",
  "not-found": "Документ не найден — обновите страницу.",
  "already-exists": "Такая запись уже есть — обновите страницу.",
  cancelled: "Запрос прервался — попробуйте ещё раз.",
  "resource-exhausted": "Превышены лимиты базы — попробуйте позже.",
  internal: "Внутренняя ошибка базы — попробуйте ещё раз.",
};

function errorCode(error: unknown): string | null {
  if (typeof error === "object" && error && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code.replace(/^firestore\//, "");
  }
  return null;
}

export function firestoreErrorText(error: unknown, fallback: string): string {
  const code = errorCode(error);
  if (code) {
    const text = CODE_TEXT[code];
    return text ? `${text} (${code})` : `${fallback} (${code})`;
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

/** Сколько ждём ответа базы, прежде чем признать, что она не отвечает. */
export const DB_TIMEOUT_MS = 15_000;

/**
 * Транзакция Firestore без связи НЕ падает — она висит: ей нужен ответ
 * сервера, а очередь офлайн-записей транзакциям не помогает. Кнопка при этом
 * остаётся в «сохраняю…» навсегда, и человек видит просто мёртвый интерфейс.
 * Поэтому у каждой такой операции есть потолок ожидания.
 */
export function withDbTimeout<T>(promise: Promise<T>, label: string, ms = DB_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label}: база не ответила за ${Math.round(ms / 1000)} с — проверьте связь и попробуйте ещё раз`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}
