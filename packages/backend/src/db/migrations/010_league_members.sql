-- League membership table
CREATE TABLE IF NOT EXISTS league_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL DEFAULT 'member',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, league_id)
);

CREATE INDEX IF NOT EXISTS idx_league_members_league ON league_members(league_id);
CREATE INDEX IF NOT EXISTS idx_league_members_user ON league_members(user_id);

-- Backfill: add commissioners of existing leagues as members
INSERT INTO league_members (user_id, league_id, role)
SELECT commissioner_id, id, 'commissioner'
FROM leagues
WHERE commissioner_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Backfill: add users who have teams in leagues as members
INSERT INTO league_members (user_id, league_id, role)
SELECT DISTINCT t.user_id, t.league_id, 'member'
FROM teams t
WHERE t.user_id IS NOT NULL
ON CONFLICT DO NOTHING;
