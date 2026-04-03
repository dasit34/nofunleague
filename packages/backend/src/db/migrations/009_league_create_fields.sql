-- Add league_size, scoring_type, and invite_code to leagues table
ALTER TABLE leagues ADD COLUMN IF NOT EXISTS league_size INTEGER NOT NULL DEFAULT 10;
ALTER TABLE leagues ADD COLUMN IF NOT EXISTS scoring_type VARCHAR(20) NOT NULL DEFAULT 'half_ppr';
ALTER TABLE leagues ADD COLUMN IF NOT EXISTS invite_code VARCHAR(20) UNIQUE;
