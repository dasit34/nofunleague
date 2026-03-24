-- =============================================
-- Trade System
-- =============================================

CREATE TABLE IF NOT EXISTS trades (
  id                  UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  league_id           UUID        NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  proposing_team_id   UUID        NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  receiving_team_id   UUID        NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  status              VARCHAR(20) NOT NULL DEFAULT 'pending',
  -- status values: pending | accepted | rejected | approved | vetoed
  proposer_note       TEXT,
  response_note       TEXT,
  commissioner_note   TEXT,
  proposed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at        TIMESTAMPTZ,
  decided_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS trade_items (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  trade_id      UUID        NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
  player_id     VARCHAR(50) NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  from_team_id  UUID        NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  to_team_id    UUID        NOT NULL REFERENCES teams(id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_trades_league_id    ON trades(league_id);
CREATE INDEX IF NOT EXISTS idx_trades_league_status ON trades(league_id, status);
CREATE INDEX IF NOT EXISTS idx_trades_proposing     ON trades(proposing_team_id);
CREATE INDEX IF NOT EXISTS idx_trades_receiving     ON trades(receiving_team_id);
CREATE INDEX IF NOT EXISTS idx_trade_items_trade    ON trade_items(trade_id);
CREATE INDEX IF NOT EXISTS idx_trade_items_player   ON trade_items(player_id);

-- Updated-at trigger
CREATE OR REPLACE TRIGGER update_trades_updated_at
  BEFORE UPDATE ON trades
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
