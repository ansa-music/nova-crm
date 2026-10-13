-- Проверки 20261048_nick_rename.sql (переименование ника). Запускать СРАЗУ
-- ПОСЛЕ core_members.sql: берёт оттуда хелперы tst.* (tst.val с почтой в
-- токене) и участников workspace W (O — создатель, TL — Тимлид, T1/T2 —
-- технари, T3 — к этому моменту ОС + Технарь, OS1 — ОС, AD — Admin, V —
-- Viewer, X — посторонний). Наборы, которые стирают core_docs у W
-- (owner_only.sql, core_docs.sql), между ними запускать нельзя. На той же базе
-- второй раз не запускается: фикстура заводит ники, и повтор упрётся в дубль.
--
-- База — с локалью, где lower() понижает кириллицу (кластер ICU:
-- initdb --locale-provider=icu --icu-locale=en-US; в Supabase это так и есть).
-- В локали C проверка «дубль без учёта регистра» провалится: это локаль, а не
-- функция.
--
-- Прогон 14.10.2026 на PostgreSQL 16.4 (все миграции дважды → desk_rows_rls.sql
-- → core_members.sql → этот файл): провалов нет; 8 намеренных поломок
-- миграции — все пойманы (проверка «пустое значение» добавлена после первой
-- из них: без неё замена защиты на «if false» проходила незамеченной).
\set ON_ERROR_STOP 1
set client_min_messages = warning;
truncate tst.results;

-- core_members.sql дважды накатывает 20261030 и возвращает
-- core_can_manage_member к версии оттуда (без Тимлид+). Проверяем на той, что
-- стоит в проде, — она в 20261036.
\ir ../migrations/20261036_leadplus.sql
\ir ../migrations/20261048_nick_rename.sql

-- Значение варианта по подписи — читает сам тест (superuser), мимо политик.
create or replace function tst.nick_value(p_list text, p_label text) returns text language sql stable as $$
  select o ->> 'value' from public.core_docs c, jsonb_array_elements(c.data -> p_list) o
  where c.workspace_id = 'W' and c.kind = 'workspace' and c.id = 'W' and o ->> 'label' = p_label
  limit 1
$$;

create or replace function tst.nick_label(p_list text, p_value text) returns text language sql stable as $$
  select o ->> 'label' from public.core_docs c, jsonb_array_elements(c.data -> p_list) o
  where c.workspace_id = 'W' and c.kind = 'workspace' and c.id = 'W' and o ->> 'value' = p_value
  limit 1
$$;

-- Фикстура — свои ники, чтобы не зависеть от того, чем кончился core_members.sql.
select tst.run('O', $q$select core_nick_add('W', 'tech', 'Ренейм А')$q$);
select tst.run('O', $q$select core_nick_add('W', 'tech', 'Ренейм Б')$q$);
select tst.run('O', $q$select core_nick_link('W', 'T3', 'tech', '{"newNick":"Ренейм В"}'::jsonb)$q$);
select tst.run('O', $q$select core_nick_link('W', 'TL', 'other', '{"newNick":"Лид А"}'::jsonb)$q$);
select tst.run('O', $q$select core_nick_link('W', 'O', 'other', '{"newNick":"Создатель А"}'::jsonb)$q$);
select tst.run('O', $q$select core_nick_link('W', 'OS1', 'os', '{"newNick":"Ос А"}'::jsonb)$q$);
-- Тимлид+ (LP) со своим ником «Другие»: его запись Тимлид не трогает.
select tst.run('O', format($q$select core_import('W', %L::jsonb, 'imported_member', false)$q$,
  jsonb_build_array(jsonb_build_object('kind', 'member', 'id', 'LP', 'data', tst.memberdoc('LP', 'leadplus')))::text));
select tst.run('O', $q$select core_nick_link('W', 'LP', 'other', '{"newNick":"Плюс А"}'::jsonb)$q$);

-- ---------------------------------------------------------------------
-- Кто вправе.
-- ---------------------------------------------------------------------
select tst.expect('технарь ник не переименовывает',
  tst.val('T1', format($q$select core_nick_rename('W', 'tech', %L, 'Хак')::text$q$, tst.nick_value('techNickOptions', 'Ренейм А'))), 'error:42501');
select tst.expect('Viewer — тоже нет',
  tst.val('V', format($q$select core_nick_rename('W', 'tech', %L, 'Хак')::text$q$, tst.nick_value('techNickOptions', 'Ренейм А'))), 'error:42501');
select tst.expect('Admin — тоже нет',
  tst.val('AD', format($q$select core_nick_rename('W', 'tech', %L, 'Хак')::text$q$, tst.nick_value('techNickOptions', 'Ренейм А'))), 'error:42501');
select tst.expect('посторонний — нет',
  tst.val('X', format($q$select core_nick_rename('W', 'tech', %L, 'Хак')::text$q$, tst.nick_value('techNickOptions', 'Ренейм А'))), 'error:42501');
select tst.expect('анонимный ключ — нет',
  tst.val('__anon_key__', format($q$select core_nick_rename('W', 'tech', %L, 'Хак')::text$q$, tst.nick_value('techNickOptions', 'Ренейм А'))), 'error:42501');
select tst.expect('…подпись после отказов прежняя', (tst.nick_value('techNickOptions', 'Ренейм А') is not null)::text, 'true');

-- ---------------------------------------------------------------------
-- Свободный ник: меняется подпись, значение прежнее.
-- ---------------------------------------------------------------------
select set_config('tst.free_value', tst.nick_value('techNickOptions', 'Ренейм А'), false);
select tst.expect('Тимлид переименовывает свободный ник (пробелы по краям срезаны)',
  tst.val('TL', format($q$select core_nick_rename('W', 'tech', %L, '  Ренейм А2  ') ->> 'label'$q$, current_setting('tst.free_value'))), 'Ренейм А2');
select tst.expect('…в списке новая подпись под тем же значением', coalesce(tst.nick_label('techNickOptions', current_setting('tst.free_value')), '<null>'), 'Ренейм А2');
select tst.expect('…старой подписи в списке нет', coalesce(tst.nick_value('techNickOptions', 'Ренейм А'), '-'), '-');
select tst.expect('у свободного ника держателей нет',
  tst.val('TL', format($q$select core_nick_rename('W', 'tech', %L, 'Ренейм А3') ->> 'uids'$q$, current_setting('tst.free_value'))), '[]');
select tst.expect('ответ несёт прежнюю подпись',
  tst.val('TL', format($q$select core_nick_rename('W', 'tech', %L, 'Ренейм А4') ->> 'oldLabel'$q$, current_setting('tst.free_value'))), 'Ренейм А3');
select tst.expect('длинная подпись режется до 32 знаков',
  tst.val('TL', format($q$select length(core_nick_rename('W', 'tech', %L, repeat('я', 40)) ->> 'label')::text$q$, current_setting('tst.free_value'))), '32');
select tst.run('TL', format($q$select core_nick_rename('W', 'tech', %L, 'Ренейм А')$q$, current_setting('tst.free_value')));

-- ---------------------------------------------------------------------
-- Отказы по данным.
-- ---------------------------------------------------------------------
select tst.expect('подпись другого ника списка (без учёта регистра) — отказ',
  tst.val('TL', format($q$select core_nick_rename('W', 'tech', %L, 'ренейм б')::text$q$, current_setting('tst.free_value'))), 'error:23505');
select tst.expect('свою подпись другим регистром — можно',
  tst.val('TL', format($q$select core_nick_rename('W', 'tech', %L, 'РЕНЕЙМ А') ->> 'label'$q$, current_setting('tst.free_value'))), 'РЕНЕЙМ А');
select tst.expect('пустая подпись — отказ',
  tst.val('TL', format($q$select core_nick_rename('W', 'tech', %L, '   ')::text$q$, current_setting('tst.free_value'))), 'error:22023');
select tst.expect('ника с таким значением нет — отказ',
  tst.val('TL', $q$select core_nick_rename('W', 'tech', 'nope', 'Что-то')::text$q$), 'error:P0002');
select tst.expect('значение из ДРУГОГО списка — отказ',
  tst.val('TL', format($q$select core_nick_rename('W', 'os', %L, 'Что-то')::text$q$, current_setting('tst.free_value'))), 'error:P0002');
select tst.expect('неизвестный вид ника — отказ',
  tst.val('TL', format($q$select core_nick_rename('W', 'boss', %L, 'Что-то')::text$q$, current_setting('tst.free_value'))), 'error:22023');
-- Пустое значение — не ник. Кривой список (вариант без значения) и участник
-- с пустым значением вместо ника: без защиты функция сочла бы его
-- «держателем» и переписала бы ему подпись.
select set_config('tst.t1_doc', (select data::text from public.core_docs where workspace_id = 'W' and kind = 'member' and id = 'T1'), false);
select set_config('tst.tech_list', (select (data -> 'techNickOptions')::text from public.core_docs where workspace_id = 'W' and kind = 'workspace' and id = 'W'), false);
update public.core_docs set data = data || jsonb_build_object('techNickOptions',
    (data -> 'techNickOptions') || '[{"value":"","label":"Пусто","color":"0 0% 50%"}]'::jsonb)
  where workspace_id = 'W' and kind = 'workspace' and id = 'W';
update public.core_docs set data = data || '{"techNickValue":"","techNick":"Был"}'::jsonb
  where workspace_id = 'W' and kind = 'member' and id = 'T1';
select tst.expect('пустое значение — не ник: отказ',
  tst.val('TL', $q$select core_nick_rename('W', 'tech', '', 'Захват')::text$q$), 'error:P0002');
select tst.expect('…подпись участника с пустым значением не тронута',
  coalesce((select data ->> 'techNick' from public.core_docs where workspace_id = 'W' and kind = 'member' and id = 'T1'), '<null>'), 'Был');
select tst.expect('…и вариант без значения в списке не переименован',
  coalesce(tst.nick_label('techNickOptions', ''), '<null>'), 'Пусто');
select tst.expect('null вместо значения — тот же отказ',
  tst.val('TL', $q$select core_nick_rename('W', 'tech', null, 'Захват')::text$q$), 'error:P0002');
update public.core_docs set data = current_setting('tst.t1_doc')::jsonb where workspace_id = 'W' and kind = 'member' and id = 'T1';
update public.core_docs set data = data || jsonb_build_object('techNickOptions', current_setting('tst.tech_list')::jsonb)
  where workspace_id = 'W' and kind = 'workspace' and id = 'W';
-- Одинаковая подпись в РАЗНЫХ списках — не дубль.
select tst.expect('та же подпись, что у ника другого списка, — можно',
  tst.val('TL', format($q$select core_nick_rename('W', 'tech', %L, 'Ос А') ->> 'label'$q$, current_setting('tst.free_value'))), 'Ос А');
select tst.run('TL', format($q$select core_nick_rename('W', 'tech', %L, 'Ренейм А')$q$, current_setting('tst.free_value')));

-- ---------------------------------------------------------------------
-- Закреплённый ник: подпись меняется и на участнике, значение — нет.
-- ---------------------------------------------------------------------
select set_config('tst.t3_value', tst.nick_value('techNickOptions', 'Ренейм В'), false);
select set_config('tst.t3_rest', (select (data - 'techNick')::text from public.core_docs where workspace_id = 'W' and kind = 'member' and id = 'T3'), false);
select tst.expect('Тимлид переименовывает ник технаря — в ответе его uid',
  tst.val('TL', format($q$select core_nick_rename('W', 'tech', %L, 'Ренейм В2') ->> 'uids'$q$, current_setting('tst.t3_value'))), '["T3"]');
select tst.expect('…подпись на участнике новая',
  coalesce((select data ->> 'techNick' from public.core_docs where workspace_id = 'W' and kind = 'member' and id = 'T3'), '<null>'), 'Ренейм В2');
select tst.expect('…значение на участнике прежнее',
  coalesce((select (data ->> 'techNickValue' = current_setting('tst.t3_value'))::text from public.core_docs where workspace_id = 'W' and kind = 'member' and id = 'T3'), '<null>'), 'true');
select tst.expect('…остальные поля участника целы (документ без подписи тот же)',
  coalesce((select ((data - 'techNick')::text = current_setting('tst.t3_rest'))::text from public.core_docs where workspace_id = 'W' and kind = 'member' and id = 'T3'), '<null>'), 'true');

-- Ник ОС: копия прав смотрит на значение — ей переименование не видно.
select set_config('tst.os_value', tst.nick_value('responsibleOptions', 'Ос А'), false);
select tst.expect('Owner переименовывает ник ОС',
  tst.val('O', format($q$select core_nick_rename('W', 'os', %L, 'Ос А2') ->> 'label'$q$, current_setting('tst.os_value'))), 'Ос А2');
select tst.expect('…подпись ника ОС на участнике новая',
  coalesce((select data ->> 'osNick' from public.core_docs where workspace_id = 'W' and kind = 'member' and id = 'OS1'), '<null>'), 'Ос А2');
select tst.expect('…ник ОС в копии прав тот же',
  coalesce((select (os_nick_value = current_setting('tst.os_value'))::text from public.rows_members where workspace_id = 'W' and uid = 'OS1'), '<null>'), 'true');

-- ---------------------------------------------------------------------
-- Чей ник трогать не положено (core_can_manage_member).
-- ---------------------------------------------------------------------
select set_config('tst.tl_value', tst.nick_value('otherNickOptions', 'Лид А'), false);
select set_config('tst.o_value', tst.nick_value('otherNickOptions', 'Создатель А'), false);
select tst.expect('Тимлид свой ник не переименовывает',
  tst.val('TL', format($q$select core_nick_rename('W', 'other', %L, 'Лид Б')::text$q$, current_setting('tst.tl_value'))), 'error:42501');
select tst.expect('…подпись в списке прежняя', coalesce(tst.nick_label('otherNickOptions', current_setting('tst.tl_value')), '<null>'), 'Лид А');
select tst.expect('…и на участнике прежняя',
  coalesce((select data ->> 'otherNick' from public.core_docs where workspace_id = 'W' and kind = 'member' and id = 'TL'), '<null>'), 'Лид А');
select tst.expect('Тимлид ник Owner не переименовывает',
  tst.val('TL', format($q$select core_nick_rename('W', 'other', %L, 'Создатель Б')::text$q$, current_setting('tst.o_value'))), 'error:42501');
select tst.expect('Owner переименовывает ник Тимлида',
  tst.val('O', format($q$select core_nick_rename('W', 'other', %L, 'Лид Б') ->> 'uids'$q$, current_setting('tst.tl_value'))), '["TL"]');
select tst.expect('создатель переименовывает свой ник',
  tst.val('O', format($q$select core_nick_rename('W', 'other', %L, 'Создатель Б') ->> 'label'$q$, current_setting('tst.o_value'))), 'Создатель Б');
-- Тимлид+ (запись Тимлид+ ведёт только Owner).
select set_config('tst.lp_value', tst.nick_value('otherNickOptions', 'Плюс А'), false);
select tst.expect('Тимлид ник Тимлид+ не переименовывает',
  tst.val('TL', format($q$select core_nick_rename('W', 'other', %L, 'Плюс Б')::text$q$, current_setting('tst.lp_value'))), 'error:42501');
select tst.expect('Тимлид+ свой ник не переименовывает',
  tst.val('LP', format($q$select core_nick_rename('W', 'other', %L, 'Плюс Б')::text$q$, current_setting('tst.lp_value'))), 'error:42501');
select tst.expect('Тимлид+ переименовывает ник технаря',
  tst.val('LP', format($q$select core_nick_rename('W', 'tech', %L, 'Ренейм В2') ->> 'label'$q$, current_setting('tst.t3_value'))), 'Ренейм В2');
select tst.expect('создатель переименовывает ник Тимлид+',
  tst.val('O', format($q$select core_nick_rename('W', 'other', %L, 'Плюс Б') ->> 'uids'$q$, current_setting('tst.lp_value'))), '["LP"]');
-- Выданный Owner: чужих ведёт, ник создателя — нет.
select tst.run('O', $q$select core_write('W', '[{"kind":"member","id":"AD","op":"merge","data":{"role":"owner"}}]'::jsonb)$q$);
select tst.expect('выданный Owner переименовывает ник технаря',
  tst.val('AD', format($q$select core_nick_rename('W', 'tech', %L, 'Ренейм В3') ->> 'label'$q$, current_setting('tst.t3_value'))), 'Ренейм В3');
select tst.expect('выданный Owner ник создателя не переименовывает',
  tst.val('AD', format($q$select core_nick_rename('W', 'other', %L, 'Создатель В')::text$q$, current_setting('tst.o_value'))), 'error:42501');
select tst.run('O', $q$select core_write('W', '[{"kind":"member","id":"AD","op":"merge","data":{"role":"admin"}}]'::jsonb)$q$);

-- ---------------------------------------------------------------------
-- Неактуальный ник и отставшая копия.
-- ---------------------------------------------------------------------
select set_config('tst.tech_n', (select jsonb_array_length(data -> 'techNickOptions')::text from public.core_docs where workspace_id = 'W' and kind = 'workspace' and id = 'W'), false);
select tst.run('TL', format($q$select core_nick_inactive('W', 'tech', %L, true)$q$, current_setting('tst.free_value')));
select tst.expect('неактуальный ник переименовывается',
  tst.val('TL', format($q$select core_nick_rename('W', 'tech', %L, 'Ренейм А5') ->> 'label'$q$, current_setting('tst.free_value'))), 'Ренейм А5');
select tst.expect('…флаг «неактуальный» на месте',
  coalesce((select o ->> 'inactive' from public.core_docs c, jsonb_array_elements(c.data -> 'techNickOptions') o
    where c.workspace_id = 'W' and c.kind = 'workspace' and o ->> 'value' = current_setting('tst.free_value')), '<null>'), 'true');
select tst.expect('…цвет варианта на месте',
  coalesce((select (o ->> 'color' is not null)::text from public.core_docs c, jsonb_array_elements(c.data -> 'techNickOptions') o
    where c.workspace_id = 'W' and c.kind = 'workspace' and o ->> 'value' = current_setting('tst.free_value')), '<null>'), 'true');
select tst.expect('…число ников в списке не изменилось',
  coalesce((select jsonb_array_length(data -> 'techNickOptions')::text from public.core_docs where workspace_id = 'W' and kind = 'workspace' and id = 'W'), '<null>'),
  current_setting('tst.tech_n'));
-- Копия на участнике отстала от списка (подпись меняли мимо функции) — та же подпись её чинит.
update public.core_docs set data = data || '{"techNick":"Старьё"}'::jsonb where workspace_id = 'W' and kind = 'member' and id = 'T3';
select tst.expect('та же подпись чинит отставшую копию',
  tst.val('TL', format($q$select core_nick_rename('W', 'tech', %L, 'Ренейм В3') ->> 'uids'$q$, current_setting('tst.t3_value'))), '["T3"]');
select tst.expect('…копия снова равна списку',
  coalesce((select data ->> 'techNick' from public.core_docs where workspace_id = 'W' and kind = 'member' and id = 'T3'), '<null>'), 'Ренейм В3');

-- ---------------------------------------------------------------------
-- Приостановленная компания и повторный накат.
-- ---------------------------------------------------------------------
update public.rows_workspaces set status = 'suspended' where workspace_id = 'W';
select tst.expect('приостановлена: ники не переименовываются',
  tst.val('O', format($q$select core_nick_rename('W', 'tech', %L, 'Нет')::text$q$, current_setting('tst.t3_value'))), 'error:42501');
update public.rows_workspaces set status = 'active' where workspace_id = 'W';

select set_config('tst.schema_v', public.nova_schema_version(), false);
\ir ../migrations/20261048_nick_rename.sql
select tst.expect('после повторного наката функция работает',
  tst.val('O', format($q$select core_nick_rename('W', 'tech', %L, 'Ренейм В4') ->> 'label'$q$, current_setting('tst.t3_value'))), 'Ренейм В4');
select tst.expect('версия схемы файлом не тронута', public.nova_schema_version(), current_setting('tst.schema_v'));

-- Служебного Тимлид+ убираем насовсем, чтобы счётчики ростера у следующих наборов не сдвинулись.
delete from public.core_docs where workspace_id = 'W' and kind = 'member' and id = 'LP';
delete from public.rows_members where workspace_id = 'W' and uid = 'LP';

select label, got from tst.results where not ok;
select format('ПРОВЕРОК (переименование ника): %s, ПРОВАЛЕНО: %s', count(*), count(*) filter (where not ok)) from tst.results;
