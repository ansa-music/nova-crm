#!/usr/bin/env bash
# Шифрованная копия базы Supabase (бесплатный тариф копий не делает).
#
# Нужны переменные:
#   SUPABASE_DB_URL     строка «Session pooler» из Supabase → Connect (с паролем).
#   BACKUP_PASSPHRASE   пароль шифрования. Без него копию не прочитать — хранить отдельно.
# Необязательно: OUT_DIR (куда класть, по умолчанию backups/), BACKUP_NAME (префикс файла),
#   PG_DUMP / PG_RESTORE (пути к бинарникам — для проверки на другой машине).
#
# Что делает: pg_dump схем public, auth и storage (не вышло с auth/storage — только public,
# с предупреждением) в формате custom → шифрует openssl (AES-256, PBKDF2) → расшифровывает
# обратно во временную папку, сверяет побайтно и читает оглавление архива pg_restore --list.
# Файлы хранилища (бакет row-files) сюда НЕ входят — только их записи в storage.objects.
#
# Восстановить (в пустой проект или базу):
#   openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass env:BACKUP_PASSPHRASE \
#     -in nova-ДАТА.dump.enc -out nova.dump
#   pg_restore --no-owner --no-privileges --clean --if-exists -d "$SUPABASE_DB_URL" nova.dump
# (в непустой базе pg_restore пожалуется «schema public already exists» — это не ошибка).
# Пароль из строки подключения в вывод не попадает: set -x не включать.
set -euo pipefail

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL не задан}"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE не задан}"
OUT_DIR="${OUT_DIR:-backups}"
PG_DUMP="${PG_DUMP:-pg_dump}"
PG_RESTORE="${PG_RESTORE:-pg_restore}"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
NAME="${BACKUP_NAME:-nova}-$STAMP"
ENC_ARGS=(-aes-256-cbc -pbkdf2 -iter 600000 -pass env:BACKUP_PASSPHRASE)

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$OUT_DIR"

dump() {
  "$PG_DUMP" --dbname="$SUPABASE_DB_URL" --format=custom --no-owner --no-privileges "$@" -f "$TMP/db.dump"
}
scope="public+auth+storage"
if ! dump --schema=public --schema=auth --schema=storage 2>"$TMP/dump.err"; then
  echo "::warning::pg_dump схем auth/storage не удался — копия только схемы public"
  tail -n 3 "$TMP/dump.err" | sed 's/postgres\(ql\)\?:\/\/[^ ]*/<url>/g' || true
  scope="public"
  dump --schema=public
fi

openssl enc "${ENC_ARGS[@]}" -salt -in "$TMP/db.dump" -out "$OUT_DIR/$NAME.dump.enc"

# Проверка: то, что лежит на диске, расшифровывается в тот же архив, и архив читается.
openssl enc -d "${ENC_ARGS[@]}" -in "$OUT_DIR/$NAME.dump.enc" -out "$TMP/check.dump"
cmp -s "$TMP/db.dump" "$TMP/check.dump"
tables="$("$PG_RESTORE" --list "$TMP/check.dump" | grep -c ' TABLE DATA ' || true)"
if [ "$tables" -lt 1 ]; then
  echo "::error::в архиве нет ни одной таблицы с данными"
  exit 1
fi
(cd "$OUT_DIR" && sha256sum "$NAME.dump.enc" > "$NAME.dump.enc.sha256")

size="$(du -h "$OUT_DIR/$NAME.dump.enc" | cut -f1)"
echo "Копия: $OUT_DIR/$NAME.dump.enc ($size, схемы: $scope, таблиц с данными: $tables)"
# Для шага workflow: имя файла и сводка.
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  {
    echo "file=$OUT_DIR/$NAME.dump.enc"
    echo "summary=$size, схемы: $scope, таблиц с данными: $tables"
  } >> "$GITHUB_OUTPUT"
fi
