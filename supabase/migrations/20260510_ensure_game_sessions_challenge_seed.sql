-- Repair partial deploys: create_game_session may reference challenge_seed before this column exists.
-- Safe on fresh installs (20260507 already adds the column; IF NOT EXISTS is a no-op).
alter table public.game_sessions
  add column if not exists challenge_seed bigint;
