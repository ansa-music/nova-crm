-- =====================================================================
-- Nova CRM — Telegram: файлы технаря через служебного бота (28.09.2026).
--
-- Просьба Nurba: «технарь не может прикреплять файлы — сделай, чтобы мог»
-- (видео клиенту по 250 МБ – 2 ГБ). Через функцию `tg` такой файл не
-- провезти (150 МБ памяти, 150 с на вызов, 5 ГБ исходящего трафика
-- Supabase в месяц), поэтому браузер технаря сам загружает файл в Telegram,
-- войдя служебным БОТОМ, и кладёт его в скрытую группу «аккаунт + бот»;
-- функция главным входом отправляет файл клиенту тем же документом.
--
-- Здесь только поля главного входа (tg_master закрыт всем, кроме
-- service_role — читает и пишет одна функция `tg`):
--   bot_token        — токен бота от @BotFather;
--   bot_id           — id бота (сверка отправителя в группе);
--   bot_username     — имя бота (показывается Owner'у);
--   courier_chat_id  — id группы-курьера (обычная группа: адрес без access_hash).
-- Повторяемый файл.
-- =====================================================================

alter table public.tg_master add column if not exists bot_token text;
alter table public.tg_master add column if not exists bot_id bigint;
alter table public.tg_master add column if not exists bot_username text;
alter table public.tg_master add column if not exists courier_chat_id bigint;

-- Таблица по-прежнему закрыта всем, кроме service_role (новые столбцы —
-- тоже: права стоят на таблицу целиком).
revoke all on public.tg_master from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Версия схемы.
-- ---------------------------------------------------------------------
create or replace function public.nova_schema_version() returns text
language sql immutable
set search_path = public, pg_temp
as $$
  select '20261037'
$$;
revoke all on function public.nova_schema_version() from public, anon, authenticated;
grant execute on function public.nova_schema_version() to anon, authenticated;
