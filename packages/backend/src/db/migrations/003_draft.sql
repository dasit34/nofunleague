-- =============================================
-- Snake Draft System
-- =============================================

-- One draft session per league (multiple seasons supported via status)
CREATE TABLE IF NOT EXISTS draft_sessions (
  id               UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  league_id        UUID         NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  status           VARCHAR(20)  NOT NULL DEFAULT 'pending', -- pending | active | paused | complete
  total_rounds     INTEGER      NOT NULL DEFAULT 15,
  seconds_per_pick INTEGER      NOT NULL DEFAULT 90,
  current_pick     INTEGER      NOT NULL DEFAULT 1,         -- 1-indexed overall pick number
  draft_order      TEXT[]       NOT NULL DEFAULT '{}',      -- team UUIDs in round-1 pick order
  started_at       TIMESTAMPTZ,
  paused_at        TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Each row is one player selection
CREATE TABLE IF NOT EXISTS draft_picks (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id   UUID        NOT NULL REFERENCES draft_sessions(id) ON DELETE CASCADE,
  league_id    UUID        NOT NULL REFERENCES leagues(id)       ON DELETE CASCADE,
  team_id      UUID        NOT NULL REFERENCES teams(id)         ON DELETE CASCADE,
  player_id    VARCHAR(50) NOT NULL REFERENCES players(id),
  overall_pick INTEGER     NOT NULL, -- 1-indexed
  round        INTEGER     NOT NULL,
  pick_in_round INTEGER    NOT NULL, -- 1-indexed position within the round
  is_auto_pick BOOLEAN     NOT NULL DEFAULT FALSE,
  picked_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(session_id, overall_pick), -- one player per slot
  UNIQUE(session_id, player_id)     -- can't draft the same player twice
);

CREATE INDEX IF NOT EXISTS idx_draft_sessions_league  ON draft_sessions(league_id);
CREATE INDEX IF NOT EXISTS idx_draft_sessions_status  ON draft_sessions(status);
CREATE INDEX IF NOT EXISTS idx_draft_picks_session    ON draft_picks(session_id);
CREATE INDEX IF NOT EXISTS idx_draft_picks_team       ON draft_picks(session_id, team_id);
CREATE INDEX IF NOT EXISTS idx_draft_picks_player     ON draft_picks(session_id, player_id);

CREATE OR REPLACE TRIGGER update_draft_sessions_updated_at
  BEFORE UPDATE ON draft_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
