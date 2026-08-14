-- Two-decimal scoring for Tempo I/II, Pitch I, Rhythm I; extend leaderboard to those games.

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
  return round(rs / 10.0, 2);
end;
$$;

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
  return round(rs / 5.0, 2);
end;
$$;

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
  return round(rs / 5.0, 2);
end;
$$;

-- Rhythm I: keep per-round accuracy at full precision; round only the final average.
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
        acc := greatest(0::numeric, 100::numeric - (avg_err / 1.0::numeric) * 100::numeric);
      end if;
    end if;
    rs := rs + acc;
  end loop;
  if pos <> len + 1 then return -1; end if;
  return round(rs / 5.0, 2);
end;
$$;

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
  if p_game_key is null or p_game_key not in (
    'melody1', 'melody2', 'melody3',
    'tempo1', 'tempo2', 'pitch1', 'rhythm1'
  ) then
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
