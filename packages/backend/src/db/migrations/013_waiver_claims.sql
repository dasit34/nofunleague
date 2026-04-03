-- Waiver claims table
CREATE TABLE IF NOT EXISTS waiver_claims (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  player_id VARCHAR(50) NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  week INTEGER NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_waiver_claims_league ON waiver_claims(league_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_waiver_claims_team ON waiver_claims(team_id, status);
CREATE INDEX IF NOT EXISTS idx_waiver_claims_player ON waiver_claims(player_id, league_id, status);
