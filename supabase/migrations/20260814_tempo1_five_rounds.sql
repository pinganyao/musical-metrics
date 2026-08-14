-- Tempo I: reduce from 10 rounds to 5.

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
  if p_transcript is null or coalesce(array_length(p_transcript, 1), 0) <> 5 then
    return -1;
  end if;
  for r in 1..5 loop
    tempo := 40 + (public.mm_sha256_byte(p_seed, 'tempo1:' || r::text) % 201);
    guess := p_transcript[r];
    if guess < 1 or guess > 400 then return -1; end if;
    rs := rs + greatest(0, 100 - abs(guess - tempo));
  end loop;
  return round(rs / 5.0, 2);
end;
$$;

notify pgrst, 'reload schema';
