-- «Скрыть суммы» (15.10.2026): переключатель workspace.hideAmounts правит только
-- Owner. В режиме «настройки в Supabase» (core_docs) это держит список
-- Owner-only ключей настроек: core_write отказывает Тимлиду в любом из них.
-- Полная копия функции из 20261043_random_settings.sql + 'hideAmounts';
-- правки списка — только в самом новом файле. Повторяемый.

create or replace function public.core_workspace_owner_keys() returns text[]
language sql immutable
set search_path = public, pg_temp
as $$
  select array['paymentMethods', 'techBonuses', 'osPay', 'scheduleSettings', 'osManagedDesks', 'techFillsAll', 'clientCardOptions', 'orderSound', 'periods', 'region', 'site', 'randomSettings', 'hideAmounts']
$$;
revoke all on function public.core_workspace_owner_keys() from public, anon, authenticated;
