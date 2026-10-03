-- ---------------------------------------------------------------------
-- Шансы «Рандома» (`randomSettings` в настройках workspace) — только Owner,
-- как в firestore.rules. Полная копия списка полей, закрытых Тимлиду, из
-- 20261031_site_builder.sql плюс `randomSettings`; правки списка — только в
-- самом новом файле. Повторяемый.
-- ---------------------------------------------------------------------
create or replace function public.core_workspace_owner_keys() returns text[]
language sql immutable
set search_path = public, pg_temp
as $$
  select array['paymentMethods', 'techBonuses', 'osPay', 'scheduleSettings', 'osManagedDesks', 'techFillsAll', 'clientCardOptions', 'orderSound', 'periods', 'region', 'site', 'randomSettings']
$$;
revoke all on function public.core_workspace_owner_keys() from public, anon, authenticated;
