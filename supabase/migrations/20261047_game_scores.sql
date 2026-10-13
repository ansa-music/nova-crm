-- =====================================================================
-- Nova CRM — рейтинг игры для перерыва (повторяемый файл).
--
-- Просьба Nurba 13.10.2026: вместо «Змейки» — простая игра «три полосы» и
-- «рейтинг среди тех, кто играл». Личный рекорд раньше жил только в
-- localStorage устройства; общий рейтинг — здесь: одна строка на человека,
-- workspace и игру, в ней его лучший счёт и число партий.
--
-- Права — по копии прав rows_* (20260923_desk_rows.sql), как у присутствия
-- (20260928b_presence.sql): читает любой участник workspace. Прямой записи в
-- таблицу нет ни у кого — счёт кладёт только функция `game_submit_score`:
-- она сама берёт uid из токена (за другого не записать), держит максимум
-- (рекорд не понизить) и режет счёт потолком. Подделать СВОЙ счёт из консоли
-- можно — это игра для перерыва, а не касса; чужой — нельзя.
--
-- Файл НИЧЕГО существующего не меняет. Версию схемы (`nova_schema_version`)
-- тоже не поднимает: клиенту она здесь не нужна — без таблицы игра работает
-- с личным рекордом, а `REQUIRED_SQL_VERSION` остаётся прежним.
-- =====================================================================

create table if not exists public.game_scores (
  workspace_id text not null references public.rows_workspaces (workspace_id) on delete cascade,
  -- Код игры: сейчас одна — 'lanes'; столбец — чтобы следующая игра не
  -- потребовала новой таблицы.
  game text not null,
  uid text not null,
  best integer not null default 0,
  plays integer not null default 0,
  -- Когда поставлен нынешний рекорд: при равном счёте выше тот, кто набрал его раньше.
  best_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, game, uid)
);

alter table public.game_scores enable row level security;

-- Строк — по одной на игравшего (десятки на workspace), поэтому функция «на
-- строку» в политике допустима (как у member_presence).
drop policy if exists game_scores_read on public.game_scores;
create policy game_scores_read on public.game_scores for select to anon, authenticated
  using (public.rows_is_member(workspace_id));
-- Политик вставки, правки и удаления нет намеренно: пишет только функция ниже.

-- Счёт партии. SECURITY DEFINER — у ролей API нет права писать в таблицу.
-- Не участник, нет токена или неизвестный код игры — строка не пишется и
-- функция возвращает пусто (клиент показывает «рейтинг недоступен»), а не
-- ошибку: как `presence_beat`, которая молча пропускает чужой workspace.
-- Коды игр — списком, а не шаблоном: иначе участник завёл бы сколько угодно
-- строк, по одной на выдуманный код. Новая игра — новый код в этом списке.
create or replace function public.game_submit_score(p_workspace text, p_game text, p_score integer)
returns table (best integer, plays integer)
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  insert into public.game_scores as g (workspace_id, game, uid, best, plays)
  select p_workspace, p_game, public.rows_uid(), greatest(0, least(coalesce(p_score, 0), 100000)), 1
  where public.rows_uid() is not null
    and public.rows_is_member(p_workspace)
    and p_game in ('lanes')
  on conflict on constraint game_scores_pkey do update set
    best_at = case when excluded.best > g.best then now() else g.best_at end,
    best = greatest(g.best, excluded.best),
    plays = g.plays + 1,
    updated_at = now()
  returning g.best, g.plays
$$;

revoke all on public.game_scores from anon, authenticated;
grant select on public.game_scores to anon, authenticated;
revoke all on function public.game_submit_score(text, text, integer) from public;
grant execute on function public.game_submit_score(text, text, integer) to anon, authenticated;
