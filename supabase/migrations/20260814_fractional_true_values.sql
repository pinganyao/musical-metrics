-- Integer guesses; fractional true BPM/cents so round scores have real hundredths.

create or replace function public.verify_score_tempo1(p_seed bigint, p_transcript integer[])
returns numeric
language plpgsql
immutable
set search_path = public
as $$
declare
  r int;
  tempo numeric;
  guess int;
  rs numeric := 0;
begin
  if p_transcript is null or coalesce(array_length(p_transcript, 1), 0) <> 5 then
    return -1;
  end if;
  for r in 1..5 loop
    tempo := 40
      + (public.mm_sha256_byte(p_seed, 'tempo1:' || r::text) % 201)
      + (public.mm_sha256_byte(p_seed, 'tempo1:h:' || r::text) % 100) / 100.0;
    guess := p_transcript[r];
    if guess < 1 or guess > 400 then return -1; end if;
    rs := rs + greatest(0::numeric, 100::numeric - abs(guess - tempo));
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
  cents numeric;
  guess int;
  rs numeric := 0;
begin
  if p_transcript is null or coalesce(array_length(p_transcript, 1), 0) <> 5 then
    return -1;
  end if;
  for r in 1..5 loop
    note_idx := public.mm_sha256_byte(p_seed, 'pitch1:n:' || r::text) % 13;
    downward := (public.mm_sha256_byte(p_seed, 'pitch1:dir:' || r::text) % 2) = 0;
    cents := 1
      + (public.mm_sha256_byte(p_seed, 'pitch1:c:' || r::text) % 50)
      + (public.mm_sha256_byte(p_seed, 'pitch1:h:' || r::text) % 100) / 100.0;
    if downward then
      cents := -cents;
    end if;
    guess := p_transcript[r];
    if guess < -50 or guess > 50 then return -1; end if;
    rs := rs + greatest(0::numeric, 100::numeric - abs(cents - guess));
  end loop;
  return round(rs / 5.0, 2);
end;
$$;

notify pgrst, 'reload schema';
