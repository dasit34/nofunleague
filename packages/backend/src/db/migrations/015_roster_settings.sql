-- Store roster configuration in leagues.settings JSONB.
-- Backfill existing leagues with the default roster config.
UPDATE leagues
SET settings = settings || '{
  "roster": {
    "qb_slots": 1,
    "rb_slots": 2,
    "wr_slots": 2,
    "te_slots": 1,
    "flex_slots": 1,
    "flex_types": "RB_WR_TE",
    "def_slots": 0,
    "k_slots": 0,
    "bench_slots": 6
  }
}'::jsonb
WHERE NOT (settings ? 'roster');
