-- True two-decimal scoring: fractional round scores for Tempo I/II and Pitch I.

create or replace function public.verify_score_tempo1(p_seed bigint, p_transcript integer[])
returns numeric
language plpgsql
immutable
set search_path = public
as $$
declare
  r int;
  tempo int;
  guess_tenths int;
  guess_bpm numeric;
  rs numeric := 0;
begin
  if p_transcript is null or coalesce(array_length(p_transcript, 1), 0) <> 5 then
    return -1;
  end if;
  for r in 1..5 loop
    tempo := 40 + (public.mm_sha256_byte(p_seed, 'tempo1:' || r::text) % 201);
    guess_tenths := p_transcript[r];
    if guess_tenths < 10 or guess_tenths > 4000 then return -1; end if;
    guess_bpm := guess_tenths / 10.0;
    rs := rs + greatest(0::numeric, 100::numeric - abs(guess_bpm - tempo));
  end loop;
  return round(rs / 5.0, 2);
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
  tap_tempo numeric;
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
        tap_tempo := 60000.0 / avg_iv;
        acc := greatest(0::numeric, 100::numeric - abs(tap_tempo - tempo));
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
  guess_tenths int;
  guess_cents numeric;
  rs numeric := 0;
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
    guess_tenths := p_transcript[r];
    if guess_tenths < -500 or guess_tenths > 500 then return -1; end if;
    guess_cents := guess_tenths / 10.0;
    rs := rs + greatest(0::numeric, 100::numeric - abs(cents - guess_cents));
  end loop;
  return round(rs / 5.0, 2);
end;
$$;

notify pgrst, 'reload schema';
