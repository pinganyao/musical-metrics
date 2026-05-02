-- Fix PostgREST / schema cache: expose a single non-overloaded signature (text, integer)
-- and avoid output column name "rank". Reload API schema cache after DDL.

drop function if exists public.leaderboard_melody(text);
drop function if exists public.leaderboard_melody(text, integer);

create or replace function public.leaderboard_melody(p_game_key text, p_limit integer)
returns table (
  leaderboard_rank bigint,
  username text,
  score numeric,
  country_code text,
  achieved_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  cap int;
begin
  if p_game_key is null or p_game_key not in ('melody1', 'melody2', 'melody3') then
    raise exception 'Invalid leaderboard game';
  end if;

  cap := least(greatest(coalesce(nullif(p_limit, 0), 100), 1), 200);

  return query
  with user_best as (
    select gs.user_id, max(gs.score)::numeric as score
    from public.game_scores gs
    where gs.game_key = p_game_key
    group by gs.user_id
  ),
  achieved as (
    select ub.user_id, ub.score, min(gs.created_at) as achieved_at
    from user_best ub
    inner join public.game_scores gs
      on gs.user_id = ub.user_id
      and gs.game_key = p_game_key
      and gs.score = ub.score
    group by ub.user_id, ub.score
  )
  select
    row_number() over (order by a.score desc, a.achieved_at asc)::bigint,
    p.username,
    a.score,
    p.country_code,
    a.achieved_at
  from achieved a
  inner join public.profiles p on p.user_id = a.user_id
  order by a.score desc, a.achieved_at asc
  limit cap;
end;
$$;

revoke all on function public.leaderboard_melody(text, integer) from public;
grant execute on function public.leaderboard_melody(text, integer) to anon, authenticated;

notify pgrst, 'reload schema';
