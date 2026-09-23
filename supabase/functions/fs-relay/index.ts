// Резервный канал к Firestore — подробности в handler.ts.
// Деплой: npx supabase functions deploy fs-relay --project-ref xoqivqqcmunavuwpsmsd --no-verify-jwt
// (--no-verify-jwt обязателен: SDK Firestore не шлёт JWT Supabase, и шлюз отклонил бы каждый запрос).
import { createRelayHandler } from "./handler.ts";

Deno.serve(createRelayHandler((url, init) => fetch(url, init)));
