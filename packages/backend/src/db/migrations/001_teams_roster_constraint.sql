-- Add unique constraint on (league_id, sleeper_roster_id) for the ON CONFLICT
-- clause used in sync-sleeper. The partial index excludes NULL sleeper_roster_id
-- rows so manually-created teams without a Sleeper mapping are not affected.
CREATE UNIQUE INDEX IF NOT EXISTS teams_league_sleeper_roster_idx
  ON teams(league_id, sleeper_roster_id)
  WHERE sleeper_roster_id IS NOT NULL;
