-- Saves the final on-screen score for logged-in users without requiring a game session
-- or verified transcript. Used when verified submit_game_score cannot run or fails,
-- so completed runs still persist.

create or replace function public.submit_game_score_display(
  p_game_key text,
  p_score numeric,
  p_score_label text default null,
  p_country_code text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_final numeric;
  v_cc text;
  v_label text;
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

  if p_score is null or p_score < 0 or p_score > 1000 then
    raise exception 'Invalid score value';
  end if;

  v_final := least(1000, p_score)::numeric;
  v_label := coalesce(nullif(trim(p_score_label), ''), v_final::text);

  insert into public.game_scores (user_id, game_key, score, score_label)
  values (v_user_id, p_game_key, v_final, v_label);

  if p_country_code is not null and length(trim(p_country_code)) >= 2 then
    v_cc := upper(left(trim(p_country_code), 2));
    if v_cc ~ '^[A-Z]{2}$' then
      update public.profiles
      set country_code = v_cc
      where user_id = v_user_id;
    end if;
  end if;
end;
$$;

revoke all on function public.submit_game_score_display(text, numeric, text, text) from public, anon, authenticated;
grant execute on function public.submit_game_score_display(text, numeric, text, text) to authenticated;

notify pgrst, 'reload schema';
