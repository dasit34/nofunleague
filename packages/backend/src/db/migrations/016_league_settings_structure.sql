-- Expand leagues.settings JSONB with full settings structure.
-- Backfills existing leagues: preserves existing roster settings,
-- adds scoring/draft/trades/waivers/season/playoffs sections with defaults.
-- Also adds new roster fields (ir_slots, superflex_slots, position limits)
-- to existing roster objects that lack them.

-- Step 1: Add missing roster fields to leagues that already have settings.roster
UPDATE leagues
SET settings = jsonb_set(
  settings,
  '{roster}',
  (settings->'roster') ||
  jsonb_build_object(
    'superflex_slots', 0,
    'ir_slots', 0,
    'max_qb', 0,
    'max_rb', 0,
    'max_wr', 0,
    'max_te', 0,
    'max_k', 0,
    'max_def', 0
  )
)
WHERE settings ? 'roster'
  AND NOT (settings->'roster' ? 'ir_slots');

-- Step 2: Add default sections for leagues missing them
UPDATE leagues
SET settings = settings || jsonb_build_object(
  'scoring', jsonb_build_object(
    'type', 'half_ppr',
    'source', 'mock'
  ),
  'draft', jsonb_build_object(
    'type', 'snake',
    'seconds_per_pick', 90,
    'auto_pick_on_timeout', true
  ),
  'trades', jsonb_build_object(
    'approval_type', 'commissioner',
    'review_period_hours', 24,
    'trade_deadline_week', 0,
    'votes_to_veto', 4,
    'allow_draft_pick_trades', false
  ),
  'waivers', jsonb_build_object(
    'type', 'standard',
    'waiver_period_days', 2,
    'faab_budget', 100,
    'process_day', 'wednesday'
  ),
  'season', jsonb_build_object(
    'regular_season_weeks', 14,
    'playoff_start_week', 15,
    'schedule_type', 'round_robin'
  ),
  'playoffs', jsonb_build_object(
    'teams', 4,
    'weeks_per_round', 1,
    'reseed', false,
    'consolation_bracket', false
  )
)
WHERE NOT (settings ? 'scoring');

-- Step 3: Sync scoring.type from the leagues.scoring_type column for existing leagues
UPDATE leagues
SET settings = jsonb_set(
  settings,
  '{scoring,type}',
  to_jsonb(scoring_type::text)
)
WHERE scoring_type IS NOT NULL
  AND settings->'scoring'->>'type' != scoring_type;

-- Step 4: Sync scoring.source from the leagues.scoring_source column
UPDATE leagues
SET settings = jsonb_set(
  settings,
  '{scoring,source}',
  to_jsonb(scoring_source::text)
)
WHERE scoring_source IS NOT NULL
  AND settings->'scoring'->>'source' != scoring_source;
