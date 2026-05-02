-- Per-game high score, average score, and attempt counts for the dashboard.
create or replace view public.my_game_score_summary
with (security_invoker = true) as
select
  game_key,
  max(score)::numeric as high_score,
  avg(score)::numeric as avg_score,
  count(*)::bigint as attempts,
  max(created_at) as last_played_at
from public.game_scores
where user_id = auth.uid()
group by game_key;

revoke all on table public.my_game_score_summary from public, anon, authenticated;
grant select on table public.my_game_score_summary to authenticated;
