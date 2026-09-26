-- =====================================================================
-- Nova CRM — файлы бакета `row-files` по токену (26.09.2026, SaaS этап 4).
-- Повторяемый файл.
--
-- До сих пор файлы (вложения строк, обложки столов, аватарки, звук заказа)
-- грузились АНОНИМНЫМ ключом, а политики бакета жили только в панели
-- Supabase и пускали роль anon — то есть кто угодно с публичным ключом мог
-- писать и удалять в папке любой компании. Здесь — политики под токен
-- Firebase (приходит ролью anon, как у desk_rows, но с `sub`):
--   первая папка пути — id workspace, где человек участник;
--   `{ws}/avatars/{uid}/…` — только свой uid;
--   `{ws}/sounds/…` (звук заказа) — только Owner этого workspace.
-- Старые политики панели НЕ трогаем: политики складываются, и вкладки на
-- старом коде продолжают грузить файлы. Когда новый код поработает и все
-- загрузки идут по токену, отдельный файл снимет старые anon-политики записи
-- (их имена показывает nova_storage_policies) — только тогда запись в чужую
-- папку закрыта по-настоящему. Чтение файлов — по-прежнему публичные ссылки
-- (в строках лежат прямые адреса; пути с uuid).
--
-- Схемой storage владеет Supabase: если прав не хватит (или схемы нет, как
-- на локальном стенде), файл только предупредит и НЕ остановит деплой.
-- =====================================================================

-- Можно ли этому человеку трогать объект по такому пути. Путь — строка
-- `name` объекта; разбор без storage.foldername, чтобы функция жила и там,
-- где схемы storage нет (тесты), и не зависела от её версии.
create or replace function public.nova_storage_path_ok(p_name text, p_write boolean) returns boolean
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  parts text[] := string_to_array(coalesce(p_name, ''), '/');
  ws text := parts[1];
  me text := public.rows_uid();
begin
  if me is null or ws is null or ws = '' or coalesce(array_length(parts, 1), 0) < 2 then
    return false;
  end if;
  if not coalesce(public.rows_is_member(ws), false) then
    return false;
  end if;
  if not p_write then
    return true;
  end if;
  if parts[2] = 'avatars' then
    return coalesce(parts[3] = me, false);
  end if;
  if parts[2] = 'sounds' then
    return coalesce(public.rows_is_owner(ws), false);
  end if;
  return true;
end;
$$;

revoke all on function public.nova_storage_path_ok(text, boolean) from public;
grant execute on function public.nova_storage_path_ok(text, boolean) to anon, authenticated;

do $$
begin
  drop policy if exists nova_rowfiles_read on storage.objects;
  create policy nova_rowfiles_read on storage.objects for select to anon, authenticated
    using (bucket_id = 'row-files' and public.nova_storage_path_ok(name, false));

  drop policy if exists nova_rowfiles_insert on storage.objects;
  create policy nova_rowfiles_insert on storage.objects for insert to anon, authenticated
    with check (bucket_id = 'row-files' and public.nova_storage_path_ok(name, true));

  drop policy if exists nova_rowfiles_update on storage.objects;
  create policy nova_rowfiles_update on storage.objects for update to anon, authenticated
    using (bucket_id = 'row-files' and public.nova_storage_path_ok(name, true))
    with check (bucket_id = 'row-files' and public.nova_storage_path_ok(name, true));

  drop policy if exists nova_rowfiles_delete on storage.objects;
  create policy nova_rowfiles_delete on storage.objects for delete to anon, authenticated
    using (bucket_id = 'row-files' and public.nova_storage_path_ok(name, true));
exception when others then
  raise warning 'row-files: политики по токену не заведены (%). Файлы грузятся по-старому.', sqlerrm;
end $$;

-- Какие политики сейчас висят на storage.objects (имена старых из панели
-- нужны, чтобы потом снять их отдельным файлом). Только Owner.
create or replace function public.nova_storage_policies(p_workspace text)
returns table (policy_name text, command text, roles text, using_expr text, check_expr text)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  if not coalesce(public.rows_is_owner(p_workspace), false) then
    raise exception 'nova_storage_policies: только Owner' using errcode = '42501';
  end if;
  return query
    select p.policyname::text, p.cmd::text, array_to_string(p.roles, ','), p.qual::text, p.with_check::text
    from pg_catalog.pg_policies p
    where p.schemaname = 'storage' and p.tablename = 'objects'
    order by p.policyname;
end;
$$;

revoke all on function public.nova_storage_policies(text) from public;
grant execute on function public.nova_storage_policies(text) to anon, authenticated;
