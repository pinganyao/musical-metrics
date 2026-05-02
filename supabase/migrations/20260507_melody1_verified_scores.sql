-- Melody I: deterministic notes from a per-session server seed + transcript validation on submit.
-- Score stored is recomputed from the transcript; client-supplied score is ignored when verification applies.

alter table public.game_sessions
  add column if not exists challenge_seed bigint;

create extension if not exists pgcrypto with schema extensions;

create or replace function public.melody1_note_from_seed(p_seed bigint, p_index integer)
returns smallint
language sql
immutable
strict
set search_path = public
as $$
  select (
    1 + (
      get_byte(
        extensions.digest(convert_to(p_seed::text || ':' || p_index::text, 'UTF8'), 'sha256'),
        0
      ) % 8
    )
  )::smallint;
$$;

-- Simulates Melody I playback: returns score (= last fully completed level minus 1 on first mistake), or -1 if invalid.
create or replace function public.melody1_score_from_transcript(p_seed bigint, p_transcript integer[])
returns integer
language plpgsql
immutable
set search_path = public
as $$
declare
  pos int := 1;
  lvl int := 1;
  i int;
  exp smallint;
  arr_len int;
begin
  if p_transcript is null then
    return -1;
  end if;

  arr_len := array_length(p_transcript, 1);
  if arr_len is null or arr_len < 1 or arr_len > 8000 then
    return -1;
  end if;

  loop
    for i in 0..(lvl - 1) loop
      exp := public.melody1_note_from_seed(p_seed, i);
      if pos > arr_len then
        return -1;
      end if;
      if p_transcript[pos] is distinct from exp::integer then
        return lvl - 1;
      end if;
      pos := pos + 1;
    end loop;
    lvl := lvl + 1;
    if lvl > 1002 then
      return 1000;
    end if;
  end loop;
end;
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
  v_seed bigint;
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

  if p_game_key = 'melody1' then
    -- Stay within JS Number.isSafeInteger range for identical SHA-256 derivation in the browser.
    v_seed := floor(random() * 9007199254740991)::bigint;
  else
    v_seed := null;
  end if;

  insert into public.game_sessions (user_id, game_key, expires_at, min_duration_seconds, challenge_seed)
  values (v_user_id, p_game_key, now() + interval '30 minutes', 1, v_seed)
  returning id into v_session_id;

  return v_session_id;
end;
$$;

drop function if exists public.submit_game_score(uuid, numeric, text, integer);
drop function if exists public.submit_game_score(uuid, numeric, text, integer, text);
drop function if exists public.submit_game_score(uuid, numeric, text, integer, text, integer[]);

create or replace function public.submit_game_score(
  p_session_id uuid,
  p_score numeric,
  p_score_label text,
  p_duration_seconds integer,
  p_country_code text default null,
  p_melody_transcript integer[] default null
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
  v_seed bigint;
  v_computed int;
  v_final numeric;
  v_cc text;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_session_id is null then
    raise exception 'Missing game session';
  end if;

  if p_duration_seconds is null or p_duration_seconds < 0 or p_duration_seconds > 7200 then
    raise exception 'Invalid duration';
  end if;

  select game_key, expires_at, used_at, min_duration_seconds, challenge_seed
  into v_game_key, v_expires_at, v_used_at, v_min_duration, v_seed
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

  if v_game_key = 'melody1' and v_seed is not null then
    if p_melody_transcript is null then
      raise exception 'Melody transcript required';
    end if;
    v_computed := public.melody1_score_from_transcript(v_seed, p_melody_transcript);
    if v_computed < 0 then
      raise exception 'Invalid melody transcript';
    end if;
    v_final := least(1000, v_computed)::numeric;
  elsif v_game_key = 'melody1' and v_seed is null then
    -- Legacy sessions created before seeds (expire within 30 minutes).
    if p_score is null or p_score < 0 or p_score > 1000 then
      raise exception 'Invalid score value';
    end if;
    v_final := p_score;
  else
    if p_score is null or p_score < 0 or p_score > 1000 then
      raise exception 'Invalid score value';
    end if;
    v_final := p_score;
  end if;

  insert into public.game_scores (user_id, game_key, score, score_label)
  values (v_user_id, v_game_key, v_final, p_score_label);

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

revoke all on function public.submit_game_score(uuid, numeric, text, integer, text, integer[]) from public, anon, authenticated;
grant execute on function public.submit_game_score(uuid, numeric, text, integer, text, integer[]) to authenticated;

revoke all on function public.melody1_note_from_seed(bigint, integer) from public;
revoke all on function public.melody1_score_from_transcript(bigint, integer[]) from public;

notify pgrst, 'reload schema';
