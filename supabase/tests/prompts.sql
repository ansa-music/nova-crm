-- Проверки «Промтов» (20261034_prompts.sql). Запускать ПОСЛЕ desk_rows_rls.sql
-- (хелперы tst.*). Свой workspace WPR.
truncate tst.results;

create or replace function tst.val(uid text, sql text) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims', tst.claims(uid), true);
  execute 'set local role anon';
  execute sql into v;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v;
exception when others then
  execute 'reset role';
  return 'error:' || sqlstate;
end;
$$;

insert into public.rows_workspaces (workspace_id, owner_id) values ('WPR', 'PO') on conflict do nothing;
insert into public.rows_members (workspace_id, uid, role, extra_roles) values
  ('WPR', 'PO', 'owner', '{}'),
  ('WPR', 'PTL', 'teamlead', '{}'),
  ('WPR', 'PT1', 'manager', '{}'),
  ('WPR', 'PT2', 'manager', '{}'),
  ('WPR', 'PS1', 'os', '{}')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- Личные.
-- ---------------------------------------------------------------------
select tst.run('PT1', $q$select prompt_save('WPR','pers000001','personal','Мой промт','для видео','СЕКРЕТНЫЙ ТЕКСТ', null, null)$q$);
select tst.expect('автор видит свой личный с текстом',
  tst.val('PT1', $q$select (select p->>'body' from jsonb_array_elements(prompt_list('WPR')->'prompts') p where p->>'id' = 'pers000001')$q$), 'СЕКРЕТНЫЙ ТЕКСТ');
select tst.expect('чужой не видит личный в списке промтов',
  tst.val('PS1', $q$select count(*)::text from jsonb_array_elements(prompt_list('WPR')->'prompts') p where p->>'id' = 'pers000001'$q$), '0');
select tst.expect('чужой видит заглушку без текста',
  tst.val('PS1', $q$select (select p::text from jsonb_array_elements(prompt_list('WPR')->'stubs') p where p->>'id' = 'pers000001') not like '%СЕКРЕТ%' $q$), 'true');
select tst.expect('заглушка — название и автор',
  tst.val('PS1', $q$select (select (p->>'title') || ':' || (p->>'authorUid') from jsonb_array_elements(prompt_list('WPR')->'stubs') p where p->>'id' = 'pers000001')$q$), 'Мой промт:PT1');
select tst.expect('Owner тоже не видит чужой личный текст',
  tst.val('PO', $q$select count(*)::text from jsonb_array_elements(prompt_list('WPR')->'prompts') p where p->>'id' = 'pers000001'$q$), '0');
select tst.expect('прямого чтения таблицы нет', tst.try('PT1', $q$select * from prompts$q$, true), 'deny');
select tst.expect('прямой записи нет', tst.try('PT1', $q$insert into prompts (workspace_id,id,kind,author_uid) values ('WPR','xx','personal','PT1')$q$), 'error');
select tst.expect('чужой не правит личный', tst.try('PT2', $q$select prompt_save('WPR','pers000001','personal','взлом','','x',null,null)$q$), 'deny:42501');
select tst.expect('Owner не правит чужой личный', tst.try('PO', $q$select prompt_save('WPR','pers000001','personal','взлом','','x',null,null)$q$), 'deny:42501');
select tst.expect('чужой не удаляет личный', tst.try('PT2', $q$select prompt_delete('WPR','pers000001')$q$), 'deny:42501');
select tst.expect('посторонний не читает', tst.try('X', $q$select prompt_list('WPR')$q$), 'deny:42501');
select tst.expect('без названия — отказ', tst.try('PT1', $q$select prompt_save('WPR','pers000002','personal','  ','','x',null,null)$q$), 'deny:22023');
select tst.expect('без текста — отказ', tst.try('PT1', $q$select prompt_save('WPR','pers000002','personal','t','',' ',null,null)$q$), 'deny:22023');
select tst.expect('кривой id — отказ', tst.try('PT1', $q$select prompt_save('WPR','a/b','personal','t','','x',null,null)$q$), 'deny:22023');
select tst.expect('фото в чужой папке — отказ',
  tst.try('PT1', $q$select prompt_save('WPR','pers000002','personal','t','','x','https://x/y.jpg','WPR/prompts/PT2/a.jpg')$q$), 'deny:22023');
select tst.expect('фото в своей папке',
  tst.try('PT1', $q$select prompt_save('WPR','pers000002','personal','t','','x','https://x/y.jpg','WPR/prompts/PT1/a.jpg')$q$), 'ok');
select tst.expect('ссылка фото не http — отказ',
  tst.try('PT1', $q$select prompt_save('WPR','pers000002','personal','t','','x','javascript:alert(1)','WPR/prompts/PT1/a.jpg')$q$), 'deny:22023');

-- ---------------------------------------------------------------------
-- Запрос доступа.
-- ---------------------------------------------------------------------
select tst.expect('автор не просит у себя', tst.try('PT1', $q$select prompt_request('WPR','pers000001')$q$), 'deny:22023');
select tst.run('PS1', $q$select prompt_request('WPR','pers000001')$q$);
select tst.expect('заглушка показывает «запрошено»',
  tst.val('PS1', $q$select (select p->>'request' from jsonb_array_elements(prompt_list('WPR')->'stubs') p where p->>'id' = 'pers000001')$q$), 'pending');
select tst.expect('автор видит запрос',
  tst.val('PT1', $q$select (prompt_list('WPR')->'requests'->0->>'uid')$q$), 'PS1');
select tst.expect('чужой запросов к чужим промтам не видит',
  tst.val('PT2', $q$select jsonb_array_length(prompt_list('WPR')->'requests')::text$q$), '0');
select tst.expect('не автор не одобряет', tst.try('PT2', $q$select prompt_resolve('WPR','pers000001','PS1',true)$q$), 'deny:42501');
select tst.expect('сам себе не одобряет', tst.try('PS1', $q$select prompt_resolve('WPR','pers000001','PS1',true)$q$), 'deny:42501');
select tst.run('PT1', $q$select prompt_resolve('WPR','pers000001','PS1',false)$q$);
select tst.expect('после отказа текста нет',
  tst.val('PS1', $q$select count(*)::text from jsonb_array_elements(prompt_list('WPR')->'prompts') p where p->>'id' = 'pers000001'$q$), '0');
select tst.expect('после отказа заглушка «отклонено»',
  tst.val('PS1', $q$select (select p->>'request' from jsonb_array_elements(prompt_list('WPR')->'stubs') p where p->>'id' = 'pers000001')$q$), 'rejected');
select tst.run('PS1', $q$select prompt_request('WPR','pers000001')$q$);
select tst.run('PT1', $q$select prompt_resolve('WPR','pers000001','PS1',true)$q$);
select tst.expect('после одобрения виден текст',
  tst.val('PS1', $q$select (select p->>'body' from jsonb_array_elements(prompt_list('WPR')->'prompts') p where p->>'id' = 'pers000001')$q$), 'СЕКРЕТНЫЙ ТЕКСТ');
select tst.expect('помечен как чужой открытый',
  tst.val('PS1', $q$select (select p->>'granted' from jsonb_array_elements(prompt_list('WPR')->'prompts') p where p->>'id' = 'pers000001')$q$), 'true');
select tst.expect('получивший не видит, кому ещё открыт',
  tst.val('PS1', $q$select (select (p->'access')::text from jsonb_array_elements(prompt_list('WPR')->'prompts') p where p->>'id' = 'pers000001')$q$), '[]');
select tst.expect('автор видит, кому открыт',
  tst.val('PT1', $q$select (select (p->'access')::text from jsonb_array_elements(prompt_list('WPR')->'prompts') p where p->>'id' = 'pers000001')$q$), '["PS1"]');
select tst.expect('после одобрения заглушки нет',
  tst.val('PS1', $q$select count(*)::text from jsonb_array_elements(prompt_list('WPR')->'stubs') p where p->>'id' = 'pers000001'$q$), '0');
select tst.expect('получивший не правит', tst.try('PS1', $q$select prompt_save('WPR','pers000001','personal','взлом','','x',null,null)$q$), 'deny:42501');
select tst.expect('третий по-прежнему не видит',
  tst.val('PT2', $q$select count(*)::text from jsonb_array_elements(prompt_list('WPR')->'prompts') p where p->>'id' = 'pers000001'$q$), '0');
select tst.expect('чужой не снимает доступ', tst.try('PS1', $q$select prompt_revoke('WPR','pers000001','PS1')$q$), 'deny:42501');
select tst.run('PT1', $q$select prompt_revoke('WPR','pers000001','PS1')$q$);
select tst.expect('после снятия текста нет',
  tst.val('PS1', $q$select count(*)::text from jsonb_array_elements(prompt_list('WPR')->'prompts') p where p->>'id' = 'pers000001'$q$), '0');
select tst.expect('после снятия можно попросить снова',
  tst.val('PS1', $q$select prompt_request('WPR','pers000001')->>'status'$q$), 'pending');

-- ---------------------------------------------------------------------
-- Общие.
-- ---------------------------------------------------------------------
select tst.expect('технарь без права не пишет общий',
  tst.try('PT2', $q$select prompt_save('WPR','shar000001','shared','Общий','для чего','ТЕКСТ',null,null)$q$), 'deny:42501');
select tst.expect('Тимлид без права не пишет общий',
  tst.try('PTL', $q$select prompt_save('WPR','shar000001','shared','Общий','для чего','ТЕКСТ',null,null)$q$), 'deny:42501');
select tst.expect('технарь не назначает писателей', tst.try('PT2', $q$select prompt_set_writers('WPR', array['PT2'])$q$), 'deny:42501');
select tst.expect('Тимлид не назначает писателей', tst.try('PTL', $q$select prompt_set_writers('WPR', array['PTL'])$q$), 'deny:42501');
select tst.run('PO', $q$select prompt_set_writers('WPR', array['PT2','NOBODY'])$q$);
select tst.expect('Owner видит писателей; постороннего uid нет',
  tst.val('PO', $q$select (prompt_list('WPR')->'writers')::text$q$), '["PT2"]');
select tst.expect('не-Owner списка писателей не видит',
  tst.val('PT2', $q$select (prompt_list('WPR')->'writers')::text$q$), '[]');
select tst.expect('писатель знает, что может',
  tst.val('PT2', $q$select prompt_list('WPR')->>'canWriteShared'$q$), 'true');
select tst.expect('остальные — нет',
  tst.val('PT1', $q$select prompt_list('WPR')->>'canWriteShared'$q$), 'false');
select tst.run('PT2', $q$select prompt_save('WPR','shar000001','shared','Общий','для чего','ОБЩИЙ ТЕКСТ',null,null)$q$);
select tst.expect('общий видят все участники с текстом',
  tst.val('PS1', $q$select (select p->>'body' from jsonb_array_elements(prompt_list('WPR')->'prompts') p where p->>'id' = 'shar000001')$q$), 'ОБЩИЙ ТЕКСТ');
select tst.expect('чужой не правит общий', tst.try('PT1', $q$select prompt_save('WPR','shar000001','shared','взлом','','x',null,null)$q$), 'deny:42501');
select tst.expect('Owner правит общий', tst.try('PO', $q$select prompt_save('WPR','shar000001','shared','Общий 2','','x',null,null)$q$), 'ok');
select tst.expect('вид не меняется правкой',
  tst.val('PT2', $q$select prompt_save('WPR','shar000001','personal','Общий','для чего','ОБЩИЙ ТЕКСТ',null,null)->>'kind'$q$), 'shared');
select tst.expect('на общий доступ не просят', tst.try('PT1', $q$select prompt_request('WPR','shar000001')$q$), 'deny:22023');
select tst.expect('чужой не удаляет общий', tst.try('PT1', $q$select prompt_delete('WPR','shar000001')$q$), 'deny:42501');
select tst.run('PO', $q$select prompt_set_writers('WPR', array[]::text[])$q$);
select tst.expect('снятый писатель не правит свой общий',
  tst.try('PT2', $q$select prompt_save('WPR','shar000001','shared','Общий','','x',null,null)$q$), 'deny:42501');
select tst.expect('Owner пишет общий без списка',
  tst.try('PO', $q$select prompt_save('WPR','shar000002','shared','Owner','','x',null,null)$q$), 'ok');
select tst.expect('Owner удаляет чужой общий', tst.try('PO', $q$select prompt_delete('WPR','shar000001')$q$), 'ok');

-- ---------------------------------------------------------------------
-- Удаление.
-- ---------------------------------------------------------------------
select tst.run('PT1', $q$select prompt_save('WPR','pers000003','personal','Фото','','x','https://x/p.jpg','WPR/prompts/PT1/p.jpg')$q$);
select tst.expect('удаление возвращает путь фото',
  tst.val('PT1', $q$select prompt_delete('WPR','pers000003')->>'photoPath'$q$), 'WPR/prompts/PT1/p.jpg');
select tst.run('PT1', $q$select prompt_delete('WPR','pers000003')$q$);
select tst.expect('удалённого нет в списке',
  tst.val('PT1', $q$select count(*)::text from jsonb_array_elements(prompt_list('WPR')->'prompts') p where p->>'id' = 'pers000003'$q$), '0');
select tst.expect('удаление мягкое, текст стёрт',
  (select deleted::text || ':' || body from public.prompts where workspace_id = 'WPR' and id = 'pers000003'), 'true:');
select tst.expect('удалённый не воскрешается правкой',
  tst.try('PT1', $q$select prompt_save('WPR','pers000003','personal','t','','x',null,null)$q$), 'deny:P0002');

-- ---------------------------------------------------------------------
-- Хранилище.
-- ---------------------------------------------------------------------
select tst.expect('фото — в свою папку', tst.val('PT1', $q$select nova_storage_path_ok('WPR/prompts/PT1/a.jpg', true)::text$q$), 'true');
select tst.expect('фото — не в чужую', tst.val('PT1', $q$select nova_storage_path_ok('WPR/prompts/PT2/a.jpg', true)::text$q$), 'false');
select tst.expect('аватар — по-прежнему только свой', tst.val('PT1', $q$select nova_storage_path_ok('WPR/avatars/PT2/a.jpg', true)::text$q$), 'false');
select tst.expect('логотип — по-прежнему только Owner', tst.val('PT1', $q$select nova_storage_path_ok('WPR/brand/a.png', true)::text$q$), 'false');

-- Приостановленная компания.
update public.rows_workspaces set status = 'suspended' where workspace_id = 'WPR';
select tst.expect('приостановленная компания — не пишет',
  tst.try('PT1', $q$select prompt_save('WPR','pers000009','personal','t','','x',null,null)$q$), 'deny:42501');
select tst.expect('приостановленная компания — читает',
  tst.try('PT1', $q$select prompt_list('WPR')$q$), 'ok');
update public.rows_workspaces set status = 'active' where workspace_id = 'WPR';

-- ---------------------------------------------------------------------
-- Повторный накат.
-- ---------------------------------------------------------------------
\ir ../migrations/20261034_prompts.sql
select tst.expect('после повторного наката промты на месте',
  tst.val('PT1', $q$select count(*)::text from jsonb_array_elements(prompt_list('WPR')->'prompts') p where p->>'id' = 'pers000001'$q$), '1');
select tst.expect('версия схемы', (nova_schema_version() >= '20261034')::text, 'true');

-- ---------------------------------------------------------------------
select case when ok then '  OK  ' else 'FAIL  ' end || label || case when ok then '' else '  → ' || got end
from tst.results order by n;
select format('ПРОВЕРОК: %s, ПРОВАЛЕНО: %s', count(*), count(*) filter (where not ok)) from tst.results;
