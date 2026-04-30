-- Lock down broad default grants on app objects.
revoke all on table public.game_scores from public, anon, authenticated;
revoke all on table public.profiles from public, anon, authenticated;
revoke all on table public.my_game_high_scores from public, anon, authenticated;
revoke all on sequence public.game_scores_id_seq from public, anon, authenticated;

-- Re-grant only the minimum needed for app behavior.
grant select, insert on table public.game_scores to authenticated;
grant usage, select on sequence public.game_scores_id_seq to authenticated;
grant select, insert, update on table public.profiles to authenticated;
grant select on table public.my_game_high_scores to authenticated;

-- Restrict accepted game keys to known routes.
alter table public.game_scores
  drop constraint if exists game_scores_game_key_check;
alter table public.game_scores
  add constraint game_scores_game_key_check
  check (game_key in (
    'melody1', 'melody2', 'melody3',
    'interval1', 'interval2',
    'harmony1', 'harmony2', 'harmony3',
    'tempo1', 'tempo2',
    'pitch1', 'rhythm1'
  ));

-- Cap unrealistic score tampering. (Allows high level-based scores while limiting abuse.)
alter table public.game_scores
  drop constraint if exists game_scores_score_reasonable_check;
alter table public.game_scores
  add constraint game_scores_score_reasonable_check
  check (score >= 0 and score <= 1000);

-- Keep helper trigger function from using mutable search_path.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- SECURITY DEFINER helper functions are internal only; do not expose as RPC.
revoke execute on function public.handle_new_user_profile() from public, anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;

-- Project had this function exposed; lock it down too.
do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'rls_auto_enable'
      and p.pronargs = 0
  ) then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end
$$;
