-- Track when a dropped player becomes available for pickup.
-- NULL = available immediately. Future timestamp = on waivers until then.
-- Scoped per league via a separate table to avoid polluting the shared players table.

CREATE TABLE IF NOT EXISTS player_waiver_locks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  player_id VARCHAR(50) NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  locked_until TIMESTAMPTZ NOT NULL,
  dropped_by_team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(league_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_pwl_league_player ON player_waiver_locks(league_id, player_id);
