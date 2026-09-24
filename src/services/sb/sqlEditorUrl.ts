import { SUPABASE_URL } from "@/lib/supabase";

/** `xoqivqqcmunavuwpsmsd` из `https://xoqivqqcmunavuwpsmsd.supabase.co`. */
function projectRef(): string | null {
  try {
    const host = new URL(SUPABASE_URL).hostname;
    return host.endsWith(".supabase.co") ? host.split(".")[0] : null;
  } catch {
    return null;
  }
}

/**
 * Прямая ссылка на новую вкладку SQL Editor проекта (или на дашборд, если
 * адрес не распознан). Отдельным модулем от `migrationSql`: тот тянет все
 * файлы миграций (~сотня КБ) и не должен попадать в стартовый набор.
 */
export function sqlEditorUrl(): string {
  const ref = projectRef();
  return ref ? `https://supabase.com/dashboard/project/${ref}/sql/new` : "https://supabase.com/dashboard/projects";
}
