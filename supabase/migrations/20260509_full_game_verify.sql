-- Anti-cheat: challenge_seed for every session + transcript verification for all games.
-- Uses mm_sha256_byte(seed, tag) matching verified-rng.js (SHA-256 first byte).

create or replace function public.mm_sha256_byte(p_seed bigint, p_tag text)
returns integer
language sql
immutable
strict
set search_path = public
as $$
  select get_byte(
    extensions.digest(convert_to(p_seed::text || ':' || p_tag, 'UTF8'), 'sha256'),
    0
  )::integer;
$$;

-- ========== Tempo I ==========
create or replace function public.verify_score_tempo1(p_seed bigint, p_transcript integer[])
returns numeric
language plpgsql
immutable
set search_path = public
as $$
declare
  r int;
  tempo int;
  guess int;
  rs numeric := 0;
begin
  if p_transcript is null or coalesce(array_length(p_transcript, 1), 0) <> 10 then
    return -1;
  end if;
  for r in 1..10 loop
    tempo := 40 + (public.mm_sha256_byte(p_seed, 'tempo1:' || r::text) % 201);
    guess := p_transcript[r];
    if guess < 1 or guess > 400 then return -1; end if;
    rs := rs + greatest(0, 100 - abs(guess - tempo));
  end loop;
  return round(rs / 10.0);
end;
$$;

-- ========== Tempo II (tap timing → accuracy from intervals; transcript packs each round) ==========
-- Format: 5 blocks: [tap_count, delta_ms_1 .. delta_ms_{tap_count-1}] where deltas are consecutive tap intervals (ms).
create or replace function public.verify_score_tempo2(p_seed bigint, p_transcript integer[])
returns numeric
language plpgsql
immutable
set search_path = public
as $$
declare
  r int;
  tempo int;
  pos int := 1;
  nt int;
  j int;
  sum_iv bigint := 0;
  avg_iv numeric;
  tap_tempo int;
  acc numeric;
  rs numeric := 0;
  len int;
begin
  if p_transcript is null then return -1; end if;
  len := array_length(p_transcript, 1);
  for r in 1..5 loop
    tempo := 40 + (public.mm_sha256_byte(p_seed, 'tempo2:' || r::text) % 201);
    if pos > len then return -1; end if;
    nt := p_transcript[pos];
    pos := pos + 1;
    if nt < 2 then
      acc := 0;
    else
      if pos + (nt - 2) > len then return -1; end if;
      sum_iv := 0;
      for j in 1..(nt - 1) loop
        if p_transcript[pos] < 1 or p_transcript[pos] > 60000 then return -1; end if;
        sum_iv := sum_iv + p_transcript[pos];
        pos := pos + 1;
      end loop;
      avg_iv := sum_iv::numeric / (nt - 1)::numeric;
      if avg_iv <= 0 then acc := 0;
      else
        tap_tempo := round(60000.0 / avg_iv);
        acc := greatest(0, 100 - abs(tap_tempo - tempo));
      end if;
    end if;
    rs := rs + acc;
  end loop;
  return round(rs / 5.0);
end;
$$;

-- ========== Pitch I (5 rounds, notes C3..C4 order matches client) ==========
create or replace function public.verify_score_pitch1(p_seed bigint, p_transcript integer[])
returns numeric
language plpgsql
immutable
set search_path = public
as $$
declare
  r int;
  note_idx int;
  downward boolean;
  cents int;
  guess int;
  rs numeric := 0;
  diff int;
begin
  if p_transcript is null or coalesce(array_length(p_transcript, 1), 0) <> 5 then
    return -1;
  end if;
  for r in 1..5 loop
    note_idx := public.mm_sha256_byte(p_seed, 'pitch1:n:' || r::text) % 13;
    downward := (public.mm_sha256_byte(p_seed, 'pitch1:dir:' || r::text) % 2) = 0;
    if downward then
      cents := -1 - (public.mm_sha256_byte(p_seed, 'pitch1:c:' || r::text) % 50);
    else
      cents := 1 + (public.mm_sha256_byte(p_seed, 'pitch1:c:' || r::text) % 50);
    end if;
    guess := p_transcript[r];
    if guess < -50 or guess > 50 then return -1; end if;
    diff := abs(cents - guess);
    rs := rs + greatest(0, 100 - diff);
  end loop;
  return round(rs / 5.0);
end;
$$;

-- ========== Interval I (10 rounds × quality_code distance) ==========
create or replace function public.verify_score_interval1(p_seed bigint, p_transcript integer[])
returns numeric
language plpgsql
immutable
set search_path = public
as $$
declare
  notes text[] := array['c#4','d4','d#4','e4','f4','f#4','g4','g#4','a4','a#4','b4','c5'];
  r int;
  ni int;
  note text;
  pq int;
  pd int;
  eq_q int;
  eq_d int;
  score int := 0;
begin
  if p_transcript is null or coalesce(array_length(p_transcript, 1), 0) <> 20 then
    return -1;
  end if;
  for r in 1..10 loop
    ni := public.mm_sha256_byte(p_seed, 'interval1:' || r::text) % 12;
    note := notes[ni + 1];
    eq_q := null;
    eq_d := null;
    case note
      when 'c#4' then eq_q := 2; eq_d := 2;
      when 'd4' then eq_q := 1; eq_d := 2;
      when 'd#4' then eq_q := 2; eq_d := 3;
      when 'e4' then eq_q := 1; eq_d := 3;
      when 'f4' then eq_q := 3; eq_d := 4;
      when 'f#4' then eq_q := 5; eq_d := 4;
      when 'g4' then eq_q := 3; eq_d := 5;
      when 'g#4' then eq_q := 2; eq_d := 6;
      when 'a4' then eq_q := 1; eq_d := 6;
      when 'a#4' then eq_q := 2; eq_d := 7;
      when 'b4' then eq_q := 1; eq_d := 7;
      when 'c5' then eq_q := 3; eq_d := 8;
      else return -1;
    end case;
    pq := p_transcript[2 * r - 1];
    pd := p_transcript[2 * r];
    if pq = eq_q and pd = eq_d then
      score := score + 1;
    end if;
  end loop;
  return score::numeric;
end;
$$;


-- ========== Interval II ==========
create or replace function public.verify_score_interval2(p_seed bigint, p_transcript integer[])
returns numeric
language plpgsql
immutable
set search_path = public
as $$
declare
  note_map int[] := array[
    -24,-23,-22,-21,-20,-19,-18,-17,-16,-15,-14,-13,
    -12,-11,-10,-9,-8,-7,-6,-5,-4,-3,-2,-1,
    0,1,2,3,4,5,6,7,8,9,10,11,12
  ];
  r int;
  fi int;
  si int;
  second_glob int;
  i int;
  cnt int;
  semitones int;
  ss int;
  eq_q int;
  eq_d int;
  pq int;
  pd int;
  score int := 0;
begin
  if p_transcript is null or coalesce(array_length(p_transcript, 1), 0) <> 20 then
    return -1;
  end if;
  for r in 1..10 loop
    fi := public.mm_sha256_byte(p_seed, 'interval2:f:' || r::text) % 37;
    si := public.mm_sha256_byte(p_seed, 'interval2:s:' || r::text) % 36;
    cnt := 0;
    second_glob := null;
    for i in 0..36 loop
      if i <> fi then
        if cnt = si then
          second_glob := i;
          exit;
        end if;
        cnt := cnt + 1;
      end if;
    end loop;
    semitones := abs(note_map[second_glob + 1] - note_map[fi + 1]);
    ss := case when semitones % 12 = 0 and semitones <> 0 then 12 else semitones % 12 end;
    eq_q := null;
    eq_d := null;
    case ss
      when 0 then eq_q := 3; eq_d := 1;
      when 1 then eq_q := 2; eq_d := 2;
      when 2 then eq_q := 1; eq_d := 2;
      when 3 then eq_q := 2; eq_d := 3;
      when 4 then eq_q := 1; eq_d := 3;
      when 5 then eq_q := 3; eq_d := 4;
      when 6 then eq_q := 5; eq_d := 4;
      when 7 then eq_q := 3; eq_d := 5;
      when 8 then eq_q := 2; eq_d := 6;
      when 9 then eq_q := 1; eq_d := 6;
      when 10 then eq_q := 2; eq_d := 7;
      when 11 then eq_q := 1; eq_d := 7;
      when 12 then eq_q := 3; eq_d := 8;
      else eq_q := 0; eq_d := 8;
    end case;
    pq := p_transcript[2 * r - 1];
    pd := p_transcript[2 * r];
    if pq = eq_q and pd = eq_d then score := score + 1; end if;
  end loop;
  return score::numeric;
end;
$$;

-- ========== Harmony I (10 × chord type index 0–5, Object.keys order) ==========
create or replace function public.verify_score_harmony1(p_seed bigint, p_transcript integer[])
returns numeric
language plpgsql
immutable
set search_path = public
as $$
declare
  score int := 0;
  r int;
  exp_t int;
begin
  if p_transcript is null or coalesce(array_length(p_transcript, 1), 0) <> 10 then
    return -1;
  end if;
  for r in 1..10 loop
    exp_t := public.mm_sha256_byte(p_seed, 'harmony1:t:' || r::text) % 6;
    if p_transcript[r] = exp_t then score := score + 1; end if;
  end loop;
  return score::numeric;
end;
$$;

-- ========== Harmony II (10 × [ui_chord_code, ext_code]) ==========
create or replace function public.verify_score_harmony2(p_seed bigint, p_transcript integer[])
returns numeric
language plpgsql
immutable
set search_path = public
as $$
declare
  score int := 0;
  r int;
  ti int;
  exp_ui int;
  exp_ext int;
  gu int;
  ge int;
begin
  if p_transcript is null or coalesce(array_length(p_transcript, 1), 0) <> 20 then
    return -1;
  end if;
  for r in 1..10 loop
    ti := public.mm_sha256_byte(p_seed, 'harmony2:t:' || r::text) % 11;
    exp_ext := 0;
    exp_ui := 0;
    if ti >= 6 then
      exp_ext := 1;
      case ti
        when 6 then exp_ui := 0;
        when 7 then exp_ui := 6;
        when 8 then exp_ui := 1;
        when 9 then exp_ui := 2;
        when 10 then exp_ui := 7;
        else exp_ui := 0; exp_ext := 0;
      end case;
    else
      exp_ui := ti;
    end if;
    gu := p_transcript[2 * r - 1];
    ge := p_transcript[2 * r];
    if gu = exp_ui and ge = exp_ext then score := score + 1; end if;
  end loop;
  return score::numeric;
end;
$$;

-- ========== Harmony III (10 × [ui_chord_code, ext_code]) ==========
create or replace function public.verify_score_harmony3(p_seed bigint, p_transcript integer[])
returns numeric
language plpgsql
immutable
set search_path = public
as $$
declare
  score int := 0;
  r int;
  ti int;
  exp_ui int;
  exp_ext int;
  gu int;
  ge int;
begin
  if p_transcript is null or coalesce(array_length(p_transcript, 1), 0) <> 20 then
    return -1;
  end if;
  for r in 1..10 loop
    ti := public.mm_sha256_byte(p_seed, 'harmony3:t:' || r::text) % 18;
    exp_ui := 0;
    exp_ext := 0;
    case ti
      when 0 then exp_ui := 0; exp_ext := 0;
      when 1 then exp_ui := 1; exp_ext := 0;
      when 2 then exp_ui := 2; exp_ext := 0;
      when 3 then exp_ui := 3; exp_ext := 0;
      when 4 then exp_ui := 4; exp_ext := 0;
      when 5 then exp_ui := 5; exp_ext := 0;
      when 6 then exp_ui := 0; exp_ext := 1;
      when 7 then exp_ui := 6; exp_ext := 1;
      when 8 then exp_ui := 1; exp_ext := 1;
      when 9 then exp_ui := 2; exp_ext := 1;
      when 10 then exp_ui := 7; exp_ext := 1;
      when 11 then exp_ui := 0; exp_ext := 2;
      when 12 then exp_ui := 1; exp_ext := 2;
      when 13 then exp_ui := 0; exp_ext := 3;
      when 14 then exp_ui := 1; exp_ext := 3;
      when 15 then exp_ui := 6; exp_ext := 3;
      when 16 then exp_ui := 0; exp_ext := 4;
      when 17 then exp_ui := 1; exp_ext := 4;
      else exp_ui := 0; exp_ext := 0;
    end case;
    gu := p_transcript[2 * r - 1];
    ge := p_transcript[2 * r];
    if gu = exp_ui and ge = exp_ext then score := score + 1; end if;
  end loop;
  return score::numeric;
end;
$$;

-- ========== Rhythm I (per round: 4 beat types 0–3 matching RHYTHM_TYPES order, tap_count, then tap_count−1 positive deltas in ms) ==========
create or replace function public.verify_score_rhythm1(p_seed bigint, p_transcript integer[])
returns numeric
language plpgsql
immutable
set search_path = public
as $$
declare
  r int;
  pos int := 1;
  len int;
  b0 int;
  b1 int;
  b2 int;
  b3 int;
  bt int;
  j int;
  jj int;
  exp_iv numeric[];
  nt int;
  exp_cnt int;
  act_iv numeric[];
  exp_rat numeric[];
  act_rat numeric[];
  fr numeric;
  n int;
  total_err numeric;
  avg_err numeric;
  acc numeric;
  rs numeric := 0;
begin
  if p_transcript is null then return -1; end if;
  len := array_length(p_transcript, 1);
  if len is null then return -1; end if;
  for r in 1..5 loop
    b0 := public.mm_sha256_byte(p_seed, 'rhythm1:b0:' || r::text) % 4;
    b1 := public.mm_sha256_byte(p_seed, 'rhythm1:b1:' || r::text) % 4;
    b2 := public.mm_sha256_byte(p_seed, 'rhythm1:b2:' || r::text) % 4;
    b3 := public.mm_sha256_byte(p_seed, 'rhythm1:b3:' || r::text) % 4;
    if pos + 4 > len then return -1; end if;
    if p_transcript[pos] <> b0 or p_transcript[pos + 1] <> b1
       or p_transcript[pos + 2] <> b2 or p_transcript[pos + 3] <> b3 then
      return -1;
    end if;
    pos := pos + 4;
    exp_iv := array[]::numeric[];
    for j in 1..4 loop
      bt := case j when 1 then b0 when 2 then b1 when 3 then b2 else b3 end;
      if bt = 0 then
        exp_iv := exp_iv || array[0.5::numeric, 0.5::numeric];
      elsif bt = 1 then
        exp_iv := exp_iv || array[(1::numeric / 3), (1::numeric / 3), (1::numeric / 3)];
      elsif bt = 2 then
        exp_iv := exp_iv || array[0.25::numeric, 0.25::numeric, 0.25::numeric, 0.25::numeric];
      else
        exp_iv := exp_iv || array[
          (1::numeric / 6), (1::numeric / 6), (1::numeric / 6),
          (1::numeric / 6), (1::numeric / 6), (1::numeric / 6)
        ];
      end if;
    end loop;
    exp_cnt := coalesce(array_length(exp_iv, 1), 0);
    if pos > len then return -1; end if;
    nt := p_transcript[pos];
    pos := pos + 1;
    if nt <> exp_cnt then return -1; end if;
    if nt < 3 then
      acc := 0::numeric;
    elsif pos + (nt - 2) > len then
      return -1;
    else
      act_iv := array[]::numeric[];
      for j in 1..(nt - 1) loop
        if p_transcript[pos] < 1 or p_transcript[pos] > 600000 then return -1; end if;
        act_iv := array_append(act_iv, p_transcript[pos]::numeric);
        pos := pos + 1;
      end loop;
      exp_rat := array[]::numeric[];
      if exp_cnt > 1 then
        fr := exp_iv[1];
        for jj in 2..exp_cnt loop
          exp_rat := array_append(exp_rat, exp_iv[jj] / nullif(fr, 0));
        end loop;
      end if;
      act_rat := array[]::numeric[];
      if nt > 2 then
        fr := act_iv[1];
        for jj in 2..(nt - 1) loop
          act_rat := array_append(act_rat, act_iv[jj] / nullif(fr, 0));
        end loop;
      end if;
      if coalesce(array_length(exp_rat, 1), 0) = 0 or coalesce(array_length(act_rat, 1), 0) = 0 then
        acc := 0::numeric;
      else
        n := least(coalesce(array_length(exp_rat, 1), 0), coalesce(array_length(act_rat, 1), 0));
        total_err := 0::numeric;
        for jj in 1..n loop
          total_err := total_err + abs(exp_rat[jj] - act_rat[jj]);
        end loop;
        avg_err := total_err / nullif(n::numeric, 0);
        acc := greatest(0::numeric, round(100::numeric - (avg_err / 1.0::numeric) * 100::numeric));
      end if;
    end if;
    rs := rs + acc;
  end loop;
  if pos <> len + 1 then return -1; end if;
  return round(rs / 5.0);
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

  v_seed := floor(random() * 9007199254740991)::bigint;

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
  p_verify_transcript integer[] default null,
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
  v_transcript integer[];
  v_computed int;
  v_final numeric;
  v_cc text;
  v_num numeric;
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

  v_transcript := coalesce(p_verify_transcript, p_melody_transcript);

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

  if v_seed is null then
    raise exception 'Missing challenge seed';
  end if;

  if v_game_key = 'melody1' then
    if v_transcript is null then
      raise exception 'Melody transcript required';
    end if;
    v_computed := public.melody1_score_from_transcript(v_seed, v_transcript);
    if v_computed < 0 then
      raise exception 'Invalid melody transcript';
    end if;
    v_final := least(1000, v_computed)::numeric;
  elsif v_game_key = 'melody2' then
    if v_transcript is null then
      raise exception 'Melody transcript required';
    end if;
    v_computed := public.melody_chain_score_from_transcript(v_seed, v_transcript, 8);
    if v_computed < 0 then
      raise exception 'Invalid melody transcript';
    end if;
    v_final := least(1000, v_computed)::numeric;
  elsif v_game_key = 'melody3' then
    if v_transcript is null then
      raise exception 'Melody transcript required';
    end if;
    v_computed := public.melody_chain_score_from_transcript(v_seed, v_transcript, 13);
    if v_computed < 0 then
      raise exception 'Invalid melody transcript';
    end if;
    v_final := least(1000, v_computed)::numeric;
  elsif v_game_key = 'tempo1' then
    if v_transcript is null then
      raise exception 'Verify transcript required';
    end if;
    v_num := public.verify_score_tempo1(v_seed, v_transcript);
    if v_num < 0 then
      raise exception 'Invalid transcript';
    end if;
    v_final := v_num;
  elsif v_game_key = 'tempo2' then
    if v_transcript is null then
      raise exception 'Verify transcript required';
    end if;
    v_num := public.verify_score_tempo2(v_seed, v_transcript);
    if v_num < 0 then
      raise exception 'Invalid transcript';
    end if;
    v_final := v_num;
  elsif v_game_key = 'pitch1' then
    if v_transcript is null then
      raise exception 'Verify transcript required';
    end if;
    v_num := public.verify_score_pitch1(v_seed, v_transcript);
    if v_num < 0 then
      raise exception 'Invalid transcript';
    end if;
    v_final := v_num;
  elsif v_game_key = 'interval1' then
    if v_transcript is null then
      raise exception 'Verify transcript required';
    end if;
    v_num := public.verify_score_interval1(v_seed, v_transcript);
    if v_num < 0 then
      raise exception 'Invalid transcript';
    end if;
    v_final := v_num;
  elsif v_game_key = 'interval2' then
    if v_transcript is null then
      raise exception 'Verify transcript required';
    end if;
    v_num := public.verify_score_interval2(v_seed, v_transcript);
    if v_num < 0 then
      raise exception 'Invalid transcript';
    end if;
    v_final := v_num;
  elsif v_game_key = 'harmony1' then
    if v_transcript is null then
      raise exception 'Verify transcript required';
    end if;
    v_num := public.verify_score_harmony1(v_seed, v_transcript);
    if v_num < 0 then
      raise exception 'Invalid transcript';
    end if;
    v_final := v_num;
  elsif v_game_key = 'harmony2' then
    if v_transcript is null then
      raise exception 'Verify transcript required';
    end if;
    v_num := public.verify_score_harmony2(v_seed, v_transcript);
    if v_num < 0 then
      raise exception 'Invalid transcript';
    end if;
    v_final := v_num;
  elsif v_game_key = 'harmony3' then
    if v_transcript is null then
      raise exception 'Verify transcript required';
    end if;
    v_num := public.verify_score_harmony3(v_seed, v_transcript);
    if v_num < 0 then
      raise exception 'Invalid transcript';
    end if;
    v_final := v_num;
  elsif v_game_key = 'rhythm1' then
    if v_transcript is null then
      raise exception 'Verify transcript required';
    end if;
    v_num := public.verify_score_rhythm1(v_seed, v_transcript);
    if v_num < 0 then
      raise exception 'Invalid transcript';
    end if;
    v_final := v_num;
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

revoke all on function public.submit_game_score(uuid, numeric, text, integer, text, integer[], integer[]) from public, anon, authenticated;
grant execute on function public.submit_game_score(uuid, numeric, text, integer, text, integer[], integer[]) to authenticated;

revoke all on function public.create_game_session(text) from public, anon, authenticated;
grant execute on function public.create_game_session(text) to authenticated;

revoke all on function public.verify_score_tempo1(bigint, integer[]) from public;
revoke all on function public.verify_score_tempo2(bigint, integer[]) from public;
revoke all on function public.verify_score_pitch1(bigint, integer[]) from public;
revoke all on function public.verify_score_interval1(bigint, integer[]) from public;
revoke all on function public.verify_score_interval2(bigint, integer[]) from public;
revoke all on function public.verify_score_harmony1(bigint, integer[]) from public;
revoke all on function public.verify_score_harmony2(bigint, integer[]) from public;
revoke all on function public.verify_score_harmony3(bigint, integer[]) from public;
revoke all on function public.verify_score_rhythm1(bigint, integer[]) from public;

notify pgrst, 'reload schema';
