// Все файлы миграций по порядку имён: «Скопировать SQL» должен давать то же,
// что накатывает деплой (scripts/supabase-sql.mjs), а не только первый файл.
// Файлы идемпотентны — вставлять их целиком повторно безопасно.
const migrationFiles = import.meta.glob("../../../supabase/migrations/*.sql", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export const migrationSql: string = Object.keys(migrationFiles)
  .sort()
  .map((path) => migrationFiles[path])
  .join("\n\n");

export { sqlEditorUrl } from "@/services/sb/sqlEditorUrl";
