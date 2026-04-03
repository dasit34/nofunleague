-- Roster transaction log
CREATE TABLE IF NOT EXISTS roster_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  player_id VARCHAR(50) NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  type VARCHAR(20) NOT NULL,  -- add | drop | move
  detail TEXT,                 -- e.g. "BN2 → WR1" or "Added from free agency"
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_roster_tx_league ON roster_transactions(league_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_roster_tx_team ON roster_transactions(team_id);
