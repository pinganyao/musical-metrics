-- Helpers required by submit_game_score (20260509) for melody1/2/3 verification.
-- Safe if already applied (CREATE OR REPLACE).

create extension if not exists pgcrypto with schema extensions;

create or replace function public.melody_rng_note(p_seed bigint, p_index integer, p_span integer)
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
      ) % p_span
    )
  )::smallint;
$$;

create or replace function public.melody1_note_from_seed(p_seed bigint, p_index integer)
returns smallint
language sql
immutable
strict
set search_path = public
as $$
  select public.melody_rng_note(p_seed, p_index, 8);
$$;

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

create or replace function public.melody_chain_score_from_transcript(
  p_seed bigint,
  p_transcript integer[],
  p_span integer
)
returns integer
language plpgsql
immutable
set search_path = public
as $$
declare
  pos int := 1;
  lvl int := 1;
  i int;
  d_start int;
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
    d_start := (lvl * (lvl - 1)) / 2;
    for i in 0..(lvl - 1) loop
      exp := public.melody_rng_note(p_seed, d_start + i, p_span);
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

revoke all on function public.melody_rng_note(bigint, integer, integer) from public;
revoke all on function public.melody_chain_score_from_transcript(bigint, integer[], integer) from public;

notify pgrst, 'reload schema';
