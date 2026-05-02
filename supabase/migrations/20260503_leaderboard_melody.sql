-- Country for leaderboard flags (updated when scores are submitted with geo hint).
alter table public.profiles
  add column if not exists country_code text;

alter table public.profiles
  drop constraint if exists profiles_country_code_format;

alter table public.profiles
  add constraint profiles_country_code_format
  check (country_code is null or country_code ~ '^[A-Z]{2}$');

drop function if exists public.submit_game_score(uuid, numeric, text, integer);

create or replace function public.submit_game_score(
  p_session_id uuid,
  p_score numeric,
  p_score_label text,
  p_duration_seconds integer,
  p_country_code text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_game_key text;
  v_expires_at timestamptz;
  v_used_at timestamptz;
  v_min_duration integer;
  v_cc text;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_session_id is null then
    raise exception 'Missing game session';
  end if;

  if p_score is null or p_score < 0 or p_score > 1000 then
    raise exception 'Invalid score value';
  end if;

  if p_duration_seconds is null or p_duration_seconds < 0 or p_duration_seconds > 7200 then
    raise exception 'Invalid duration';
  end if;

  select game_key, expires_at, used_at, min_duration_seconds
  into v_game_key, v_expires_at, v_used_at, v_min_duration
  from public.game_sessions
  where id = p_session_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Game session not found';
  end if;

  if v_used_at is not null then
    raise exception 'Game session already used';
  end if;

  if now() > v_expires_at then
    raise exception 'Game session expired';
  end if;

  if p_duration_seconds < v_min_duration then
    raise exception 'Game finished too quickly';
  end if;

  insert into public.game_scores (user_id, game_key, score, score_label)
  values (v_user_id, v_game_key, p_score, p_score_label);

  if p_country_code is not null and length(trim(p_country_code)) >= 2 then
    v_cc := upper(left(trim(p_country_code), 2));
    if v_cc ~ '^[A-Z]{2}$' then
      update public.profiles
      set country_code = v_cc
      where user_id = v_user_id;
    end if;
  end if;

  update public.game_sessions
  set used_at = now()
  where id = p_session_id;
end;
$$;

revoke all on function public.submit_game_score(uuid, numeric, text, integer, text) from public, anon, authenticated;
grant execute on function public.submit_game_score(uuid, numeric, text, integer, text) to authenticated;

-- Public read-only leaderboard for Melody I–III (best score per user).
create or replace function public.leaderboard_melody(p_game_key text, p_limit int default 100)
returns table (
  rank bigint,
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
