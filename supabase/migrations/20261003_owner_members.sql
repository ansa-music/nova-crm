-- =====================================================================
-- Роль Owner выдаёт и забирает только создатель workspace (25.09.2026,
-- просьба Nurba: «овнера не могут менять роли другого — только я как
-- создатель забираю или отдаю овнера»).
--
-- Копия прав (rows_members) повторяет firestore.rules (members):
--   * создатель (rows_workspaces.owner_id) — любые записи, как раньше;
--   * выданный Owner — как Тимлид: роль owner не выдаёт, записи других Owner
--     и создателя не трогает; свою строку правит (вторая роль, ник ОС).
-- Без этого выданный Owner вписал бы в копию кому угодно роль owner и открыл
-- ему все строки, хотя в Firestore тот Owner не стал.
--
-- Файл повторяемый: функции — create or replace, политики — drop if exists.
-- =====================================================================

create or replace function public.rows_is_creator(ws text) returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select public.rows_uid() is not null
    and exists (select 1 from public.rows_workspaces w where w.workspace_id = ws and w.owner_id = public.rows_uid())
$$;

revoke all on function public.rows_is_creator(text) from public;
grant execute on function public.rows_is_creator(text) to anon, authenticated;

-- Создатель — всё.
drop policy if exists rows_members_owner on public.rows_members;
create policy rows_members_owner on public.rows_members for all to anon, authenticated
  using (public.rows_is_creator(workspace_id))
  with check (public.rows_is_creator(workspace_id));

-- Выданный Owner: не создатель, записи Owner — только своя.
drop policy if exists rows_members_granted_owner_insert on public.rows_members;
create policy rows_members_granted_owner_insert on public.rows_members for insert to anon, authenticated
  with check (
    public.rows_is_owner(workspace_id)
    and role <> 'owner'
    and uid <> coalesce((select w.owner_id from public.rows_workspaces w where w.workspace_id = rows_members.workspace_id), '')
  );

drop policy if exists rows_members_granted_owner_update on public.rows_members;
create policy rows_members_granted_owner_update on public.rows_members for update to anon, authenticated
  using (
    public.rows_is_owner(workspace_id)
    and uid <> coalesce((select w.owner_id from public.rows_workspaces w where w.workspace_id = rows_members.workspace_id), '')
    and (role <> 'owner' or uid = public.rows_uid())
  )
  with check (
    public.rows_is_owner(workspace_id)
    and uid <> coalesce((select w.owner_id from public.rows_workspaces w where w.workspace_id = rows_members.workspace_id), '')
    and (role <> 'owner' or uid = public.rows_uid())
  );

drop policy if exists rows_members_granted_owner_delete on public.rows_members;
create policy rows_members_granted_owner_delete on public.rows_members for delete to anon, authenticated
  using (
    public.rows_is_owner(workspace_id)
    and role <> 'owner'
    and uid <> coalesce((select w.owner_id from public.rows_workspaces w where w.workspace_id = rows_members.workspace_id), '')
  );
