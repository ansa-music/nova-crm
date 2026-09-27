-- =====================================================================
-- Nova CRM — логотип компании в хранилище (26.09.2026, «Конструктор сайта»).
-- Повторяемый файл.
--
-- Логотип лежит в бакете `row-files` по пути `{ws}/brand/logo-….png`: его
-- видят все (меню, вкладка браузера), а менять его вправе только Owner — как
-- звук заказа (`{ws}/sounds/…`). Функция — полная копия из
-- 20261024_storage_policies.sql плюс ветка `brand`; правки функции — только
-- в самом новом файле. Версию схемы не поднимаем: это ужесточение, клиент
-- без него работает (загрузка откатится на анонимный ключ, как раньше).
-- =====================================================================

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
  if parts[2] in ('sounds', 'brand') then
    return coalesce(public.rows_is_owner(ws), false);
  end if;
  return true;
end;
$$;

revoke all on function public.nova_storage_path_ok(text, boolean) from public;
grant execute on function public.nova_storage_path_ok(text, boolean) to anon, authenticated;

-- ---------------------------------------------------------------------
-- «Конструктор сайта» (`site` в настройках workspace) — только Owner, как
-- в firestore.rules. Список полей настроек, закрытых Тимлиду, — копия из
-- 20261030_core_members.sql плюс `site`; правки списка — только в самом
-- новом файле.
-- ---------------------------------------------------------------------
create or replace function public.core_workspace_owner_keys() returns text[]
language sql immutable
set search_path = public, pg_temp
as $$
  select array['paymentMethods', 'techBonuses', 'osPay', 'scheduleSettings', 'osManagedDesks', 'techFillsAll', 'clientCardOptions', 'orderSound', 'periods', 'region', 'site']
$$;
revoke all on function public.core_workspace_owner_keys() from public, anon, authenticated;
