-- =====================================================================
-- Nova CRM — удаление заказа с «Заказов» убирает и его строку в столе
-- технаря (повторяемый файл).
--
-- Заказ удаляет тот, кто его выдал (ОС), Тимлид или Owner. Первые двое
-- в стол технаря писать не вправе, а строка, приехавшая с биржи, у технаря
-- оставалась висеть «В работе». Эта функция убирает РОВНО одну строку —
-- рождённую заказом (`order_id` = заказ, и это не строка-заказ стола ОС:
-- `os_uid` пуст, ту убирает сам ОС по обычной политике).
--
-- SECURITY DEFINER: политики удаления строк такого человека не пускают.
-- Пускает здесь: Owner, Тимлид и любой с ролью ОС (основной или второй).
-- Честная граница: Postgres не видит документ заказа в Firestore и не может
-- проверить, что ОС выдал ИМЕННО этот заказ — это проверяют правила
-- Firestore на удаление самого заказа, а интерфейс зовёт функцию только
-- из удаления своего заказа. Чтобы убрать чужую строку в обход, ОС нужен
-- id заказа и адрес строки; навредить так можно только строкой с биржи, и
-- она не пропадает бесследно — заказ остаётся в «Заказах».
-- =====================================================================

create or replace function public.rows_drop_order_row(
  p_workspace text,
  p_page text,
  p_tab text,
  p_row text,
  p_order text
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  n integer;
begin
  if public.rows_uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if coalesce(p_order, '') = '' then
    raise exception 'order id required' using errcode = '22023';
  end if;
  if p_workspace not in (select public.rows_writable_workspaces()) then
    raise exception 'rows storage is not writable' using errcode = '42501';
  end if;
  -- coalesce обязателен: для не участника rows_is_owner отдаёт NULL, а
  -- `if not NULL` в plpgsql молча пропускает — посторонний прошёл бы.
  if not coalesce(
    public.rows_is_owner(p_workspace)
    or public.rows_is_teamlead(p_workspace)
    or public.rows_has_role(p_workspace, 'os'),
    false
  ) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  delete from public.desk_rows r
  where r.workspace_id = p_workspace
    and r.page_id = p_page
    and r.tab_id = coalesce(p_tab, '')
    and r.id = p_row
    and r.order_id = p_order
    and r.os_uid is null;
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

revoke all on function public.rows_drop_order_row(text, text, text, text, text) from public;
grant execute on function public.rows_drop_order_row(text, text, text, text, text) to anon, authenticated;
