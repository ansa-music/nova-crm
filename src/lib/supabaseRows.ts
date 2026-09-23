import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { onIdTokenChanged } from "firebase/auth";
import { auth } from "@/firebase/firebase";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase";

/**
 * Клиент Supabase для СТРОК ТАБЛИЦ — с входом через Firebase.
 *
 * Каждый запрос несёт ID-токен Firebase вошедшего человека (Supabase →
 * Third-party Auth → Firebase), и политики `desk_rows` решают по его uid —
 * теми же правилами, что `canAccessPage`/`canEditPage` в firestore.rules.
 *
 * Отдельный клиент, а не общий `supabase`: тот ходит анонимным ключом в
 * Storage (вложения, обложки, аватарки), и политики бакета написаны под роль
 * anon. Токен Firebase может прийти ролью authenticated — и под общим
 * клиентом загрузки файлов молча упёрлись бы в чужие политики.
 */
export const supabaseRows: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  accessToken: async () => {
    const user = auth.currentUser;
    // Без входа — анонимный ключ, и политики не отдадут ни одной строки.
    return user ? await user.getIdToken() : null;
  },
});

// Токен Firebase живёт час и обновляется сам; Realtime держит соединение
// дольше — отдаём ему свежий, как только Firebase его выпустил.
onIdTokenChanged(auth, () => {
  void supabaseRows.realtime.setAuth().catch(() => undefined);
});

/** Таблица строк и её ключ — см. supabase/migrations/20260923_desk_rows.sql. */
export const DESK_ROWS_TABLE = "desk_rows";
export const DESK_ROWS_CONFLICT = "workspace_id,page_id,tab_id,id";
