-- Add scoring_source to leagues: 'mock' (random) or 'real' (from player_stats)
ALTER TABLE leagues ADD COLUMN IF NOT EXISTS scoring_source VARCHAR(10) NOT NULL DEFAULT 'mock';

-- Add scoring_source to matchups to track how each was scored
ALTER TABLE matchups ADD COLUMN IF NOT EXISTS scoring_source VARCHAR(10);

-- Backfill existing completed matchups as mock-scored
UPDATE matchups SET scoring_source = 'mock' WHERE is_complete = TRUE AND scoring_source IS NULL;
