-- =============================================
-- NFL Game Schedule Cache
-- Stores kickoff times per game per week so the roster endpoint
-- can enforce lineup lock without hitting Sleeper on every request.
-- =============================================

CREATE TABLE IF NOT EXISTS nfl_games (
  season       INTEGER     NOT NULL,
  week         INTEGER     NOT NULL,
  season_type  VARCHAR(20) NOT NULL DEFAULT 'regular',
  home_team    VARCHAR(10) NOT NULL,
  away_team    VARCHAR(10) NOT NULL,
  game_start   TIMESTAMPTZ NOT NULL,
  status       VARCHAR(20) NOT NULL DEFAULT 'pre_game', -- pre_game | in_game | complete
  synced_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (season, week, season_type, home_team, away_team)
);

CREATE INDEX IF NOT EXISTS idx_nfl_games_season_week ON nfl_games(season, week, season_type);
