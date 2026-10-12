/**
 * Пустышка вместо `@supabase/auth-js` (подменяется в сборке — см. alias в
 * vite.config.ts). Вход в Nova — через Firebase: оба клиента Supabase созданы
 * с опцией `accessToken`, и в этом режиме supabase-js модуль входа НЕ создаёт
 * вовсе. Но сам класс он импортирует всегда — и ~130 КБ кода входа Supabase
 * (сессии, OAuth, WebAuthn) ехали в стартовый набор каждому, ни разу не
 * выполняясь.
 *
 * Конструктор бросает ошибку намеренно: если кто-то заведёт клиент Supabase
 * БЕЗ `accessToken`, это станет видно сразу, а не тихой порчей запросов.
 * Равенство запросов «до/после» проверяет scripts/check-supabase-auth-stub.mjs.
 */
export class AuthClient {
  constructor() {
    throw new Error(
      "Nova: клиент Supabase создан без опции accessToken — модуль входа Supabase в сборку не включён (src/lib/supabaseAuthStub.ts)"
    );
  }
}
