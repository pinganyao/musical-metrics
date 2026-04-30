create table if not exists public.game_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  game_key text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  min_duration_seconds integer not null default 1,
  constraint game_sessions_game_key_check check (game_key in (
    'melody1', 'melody2', 'melody3',
    'interval1', 'interval2',
    'harmony1', 'harmony2', 'harmony3',
    'tempo1', 'tempo2',
    'pitch1', 'rhythm1'
  ))
);

create index if not exists game_sessions_user_idx
  on public.game_sessions (user_id, created_at desc);

alter table public.game_sessions enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'game_sessions'
      and policyname = 'Users can read own sessions'
  ) then
    create policy "Users can read own sessions"
      on public.game_sessions
      for select
      to authenticated
      using (auth.uid() = user_id);
  end if;
end
$$;

create or replace function public.create_game_session(p_game_key text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_session_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_game_key is null or p_game_key not in (
    'melody1', 'melody2', 'melody3',
    'interval1', 'interval2',
    'harmony1', 'harmony2', 'harmony3',
    'tempo1', 'tempo2',
    'pitch1', 'rhythm1'
  ) then
    raise exception 'Invalid game key';
  end if;

  insert into public.game_sessions (user_id, game_key, expires_at, min_duration_seconds)
  values (v_user_id, p_game_key, now() + interval '30 minutes', 1)
  returning id into v_session_id;

  return v_session_id;
end;
$$;

create or replace function public.submit_game_score(
  p_session_id uuid,
  p_score numeric,
  p_score_label text,
  p_duration_seconds integer
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

  update public.game_sessions
  set used_at = now()
  where id = p_session_id;
end;
$$;

revoke all on table public.game_sessions from public, anon, authenticated;
grant select on table public.game_sessions to authenticated;

revoke all on function public.create_game_session(text) from public, anon, authenticated;
revoke all on function public.submit_game_score(uuid, numeric, text, integer) from public, anon, authenticated;
grant execute on function public.create_game_session(text) to authenticated;
grant execute on function public.submit_game_score(uuid, numeric, text, integer) to authenticated;

revoke insert on table public.game_scores from authenticated;
