-- =============================================
-- League Invite Codes
-- =============================================

CREATE TABLE IF NOT EXISTS league_invites (
  id          UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  league_id   UUID         NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  code        VARCHAR(12)  NOT NULL UNIQUE,
  created_by  UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  max_uses    INTEGER      DEFAULT NULL,   -- NULL = unlimited
  uses        INTEGER      NOT NULL DEFAULT 0,
  expires_at  TIMESTAMPTZ  DEFAULT NULL,   -- NULL = never expires
  is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_league_invites_league  ON league_invites(league_id);
CREATE INDEX IF NOT EXISTS idx_league_invites_code    ON league_invites(code);
