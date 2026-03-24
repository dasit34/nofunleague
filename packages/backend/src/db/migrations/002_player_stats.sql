-- Individual player game stats per week, sourced from Sleeper.
-- Stores raw Sleeper stat fields in JSONB and pre-calculated fantasy points
-- for the three standard scoring formats (standard, half-PPR, PPR).
-- Custom league scoring is computed on the fly from the raw stats JSONB.

CREATE TABLE IF NOT EXISTS player_stats (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  player_id        VARCHAR(50) NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  season           INTEGER     NOT NULL,
  week             INTEGER     NOT NULL,
  season_type      VARCHAR(10) NOT NULL DEFAULT 'regular', -- regular | pre | post
  stats            JSONB       NOT NULL DEFAULT '{}',      -- raw Sleeper fields
  projected        JSONB       NOT NULL DEFAULT '{}',      -- projection snapshot
  fantasy_pts_std  DECIMAL(8,2) NOT NULL DEFAULT 0,       -- standard (no PPR)
  fantasy_pts_half DECIMAL(8,2) NOT NULL DEFAULT 0,       -- half-PPR
  fantasy_pts_ppr  DECIMAL(8,2) NOT NULL DEFAULT 0,       -- full PPR
  last_synced_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(player_id, season, week, season_type)
);

CREATE INDEX IF NOT EXISTS idx_player_stats_season_week
  ON player_stats(season, week);

CREATE INDEX IF NOT EXISTS idx_player_stats_player_season
  ON player_stats(player_id, season);

-- Fast lookup for leaderboard queries sorted by PPR points
CREATE INDEX IF NOT EXISTS idx_player_stats_ppr_score
  ON player_stats(season, week, fantasy_pts_ppr DESC);
