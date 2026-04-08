-- Per-player weekly scoring records.
-- Stores individual player points and stat breakdowns for each week.
-- Complements the existing weekly_scores table (team-level summaries).

CREATE TABLE IF NOT EXISTS player_weekly_scores (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  player_id VARCHAR(50) NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  week INTEGER NOT NULL,
  points DECIMAL(10, 2) DEFAULT 0,
  is_starter BOOLEAN DEFAULT FALSE,
  stat_breakdown JSONB DEFAULT '{}',  -- { pass_yd: 12.0, pass_td: 8, rec: 0.5, ... }
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(league_id, team_id, player_id, week)
);

CREATE INDEX IF NOT EXISTS idx_pws_league_week ON player_weekly_scores(league_id, week);
CREATE INDEX IF NOT EXISTS idx_pws_team_week ON player_weekly_scores(team_id, week);

-- Add updated_at trigger
CREATE OR REPLACE TRIGGER update_pws_updated_at
  BEFORE UPDATE ON player_weekly_scores
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
