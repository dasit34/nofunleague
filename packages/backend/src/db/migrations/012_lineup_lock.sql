-- Track which week lineups are locked through.
-- If lineup_locked_week >= league.week, lineups for the current week are locked.
ALTER TABLE leagues ADD COLUMN IF NOT EXISTS lineup_locked_week INTEGER NOT NULL DEFAULT 0;
