-- =============================================
-- The No Fun League — Database Schema
-- =============================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================
-- USERS
-- =============================================
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username VARCHAR(50) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(100),
  avatar_url TEXT,
  sleeper_user_id VARCHAR(100),
  trash_talk_style VARCHAR(50) DEFAULT 'aggressive', -- aggressive | petty | poetic | silent
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- LEAGUES
-- =============================================
CREATE TABLE IF NOT EXISTS leagues (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL,
  sleeper_league_id VARCHAR(100) UNIQUE,
  commissioner_id UUID REFERENCES users(id) ON DELETE SET NULL,
  season INTEGER NOT NULL DEFAULT EXTRACT(YEAR FROM NOW()),
  week INTEGER NOT NULL DEFAULT 1,
  status VARCHAR(20) DEFAULT 'pre_draft', -- pre_draft | drafting | in_season | post_season | complete
  settings JSONB DEFAULT '{}',
  ai_enabled BOOLEAN DEFAULT TRUE,
  chaos_mode BOOLEAN DEFAULT FALSE,  -- Phase 2: extra AI chaos
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- TEAMS
-- =============================================
CREATE TABLE IF NOT EXISTS teams (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  league_id UUID REFERENCES leagues(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  name VARCHAR(100) NOT NULL,
  sleeper_roster_id INTEGER,
  wins INTEGER DEFAULT 0,
  losses INTEGER DEFAULT 0,
  ties INTEGER DEFAULT 0,
  points_for DECIMAL(10, 2) DEFAULT 0,
  points_against DECIMAL(10, 2) DEFAULT 0,
  waiver_priority INTEGER,
  faab_balance INTEGER DEFAULT 100,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(league_id, user_id)
);

-- =============================================
-- PLAYERS (cached from Sleeper)
-- =============================================
CREATE TABLE IF NOT EXISTS players (
  id VARCHAR(50) PRIMARY KEY, -- Sleeper player_id
  full_name VARCHAR(150),
  first_name VARCHAR(75),
  last_name VARCHAR(75),
  position VARCHAR(10), -- QB | RB | WR | TE | K | DEF
  nfl_team VARCHAR(10),
  jersey_number INTEGER,
  status VARCHAR(20), -- Active | Inactive | Injured Reserve
  injury_status VARCHAR(20),
  age INTEGER,
  years_exp INTEGER,
  college VARCHAR(100),
  fantasy_positions TEXT[], -- array of eligible positions
  metadata JSONB DEFAULT '{}',
  last_synced_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- ROSTERS
-- =============================================
CREATE TABLE IF NOT EXISTS rosters (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  player_id VARCHAR(50) REFERENCES players(id) ON DELETE CASCADE,
  acquisition_type VARCHAR(20) DEFAULT 'draft', -- draft | waiver | trade | free_agent
  acquisition_week INTEGER,
  is_starter BOOLEAN DEFAULT FALSE,
  roster_slot VARCHAR(20), -- QB | RB | WR | TE | FLEX | K | DEF | BN
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(team_id, player_id)
);

-- =============================================
-- MATCHUPS
-- =============================================
CREATE TABLE IF NOT EXISTS matchups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  league_id UUID REFERENCES leagues(id) ON DELETE CASCADE,
  week INTEGER NOT NULL,
  home_team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  away_team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  home_score DECIMAL(10, 2) DEFAULT 0,
  away_score DECIMAL(10, 2) DEFAULT 0,
  winner_team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  is_playoffs BOOLEAN DEFAULT FALSE,
  is_complete BOOLEAN DEFAULT FALSE,
  sleeper_matchup_id INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(league_id, week, home_team_id, away_team_id)
);

-- =============================================
-- WEEKLY SCORES
-- =============================================
CREATE TABLE IF NOT EXISTS weekly_scores (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  league_id UUID REFERENCES leagues(id) ON DELETE CASCADE,
  week INTEGER NOT NULL,
  total_points DECIMAL(10, 2) DEFAULT 0,
  projected_points DECIMAL(10, 2) DEFAULT 0,
  player_scores JSONB DEFAULT '[]', -- [{player_id, points, projected, is_starter}]
  highest_scorer_id VARCHAR(50) REFERENCES players(id),
  biggest_bust_id VARCHAR(50) REFERENCES players(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(team_id, week)
);

-- =============================================
-- LEAGUE CHAT
-- =============================================
CREATE TABLE IF NOT EXISTS league_chat (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  league_id UUID REFERENCES leagues(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  is_ai BOOLEAN DEFAULT FALSE,
  ai_target_team_id UUID REFERENCES teams(id) ON DELETE SET NULL, -- who the AI is clowning on
  message TEXT NOT NULL,
  message_type VARCHAR(30) DEFAULT 'chat', -- chat | trash_talk | weekly_recap | system
  week INTEGER,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- AI GENERATIONS LOG
-- =============================================
CREATE TABLE IF NOT EXISTS ai_generations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  league_id UUID REFERENCES leagues(id) ON DELETE CASCADE,
  generation_type VARCHAR(50) NOT NULL, -- trash_talk | weekly_recap | draft_commentary | trade_reaction
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  model VARCHAR(50),
  input_context JSONB DEFAULT '{}',
  output_text TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- INDEXES
-- =============================================
CREATE INDEX IF NOT EXISTS idx_teams_league_id ON teams(league_id);
CREATE INDEX IF NOT EXISTS idx_rosters_team_id ON rosters(team_id);
CREATE INDEX IF NOT EXISTS idx_matchups_league_week ON matchups(league_id, week);
CREATE INDEX IF NOT EXISTS idx_weekly_scores_team_week ON weekly_scores(team_id, week);
CREATE INDEX IF NOT EXISTS idx_league_chat_league_id ON league_chat(league_id);
CREATE INDEX IF NOT EXISTS idx_league_chat_created ON league_chat(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_players_position ON players(position);
CREATE INDEX IF NOT EXISTS idx_players_nfl_team ON players(nfl_team);

-- =============================================
-- UPDATED_AT TRIGGER
-- =============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE OR REPLACE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE OR REPLACE TRIGGER update_leagues_updated_at BEFORE UPDATE ON leagues FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE OR REPLACE TRIGGER update_teams_updated_at BEFORE UPDATE ON teams FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE OR REPLACE TRIGGER update_matchups_updated_at BEFORE UPDATE ON matchups FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE OR REPLACE TRIGGER update_weekly_scores_updated_at BEFORE UPDATE ON weekly_scores FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
