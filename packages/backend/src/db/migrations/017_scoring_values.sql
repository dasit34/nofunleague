-- Backfill existing leagues with per-stat scoring values based on their scoring_type.
-- Existing leagues have settings.scoring = { type, source } only.
-- This adds the full per-stat values so the scoring engine can read them.

-- Base values shared across all presets
-- Only the 'rec' (reception) value differs between presets.

-- Standard scoring (rec = 0)
UPDATE leagues
SET settings = jsonb_set(
  settings,
  '{scoring}',
  (settings->'scoring') || jsonb_build_object(
    'pass_yd', 0.04, 'pass_td', 4, 'pass_int', -2, 'pass_2pt', 2,
    'rush_yd', 0.1, 'rush_td', 6, 'rush_2pt', 2,
    'rec', 0, 'rec_yd', 0.1, 'rec_td', 6, 'rec_2pt', 2,
    'fum_lost', -2,
    'fg_0_19', 3, 'fg_20_29', 3, 'fg_30_39', 3, 'fg_40_49', 4, 'fg_50p', 5,
    'xpt', 1, 'xpt_miss', -1,
    'def_sack', 1, 'def_int', 2, 'def_fum_rec', 2, 'def_td', 6, 'def_st_td', 6,
    'def_safe', 2, 'def_blk_kick', 2,
    'def_pts_allow_0', 10, 'def_pts_allow_1_6', 7, 'def_pts_allow_7_13', 4,
    'def_pts_allow_14_20', 1, 'def_pts_allow_21_27', 0, 'def_pts_allow_28_34', -1, 'def_pts_allow_35p', -4
  )
)
WHERE scoring_type = 'standard'
  AND NOT (settings->'scoring' ? 'pass_yd');

-- Half-PPR scoring (rec = 0.5)
UPDATE leagues
SET settings = jsonb_set(
  settings,
  '{scoring}',
  (settings->'scoring') || jsonb_build_object(
    'pass_yd', 0.04, 'pass_td', 4, 'pass_int', -2, 'pass_2pt', 2,
    'rush_yd', 0.1, 'rush_td', 6, 'rush_2pt', 2,
    'rec', 0.5, 'rec_yd', 0.1, 'rec_td', 6, 'rec_2pt', 2,
    'fum_lost', -2,
    'fg_0_19', 3, 'fg_20_29', 3, 'fg_30_39', 3, 'fg_40_49', 4, 'fg_50p', 5,
    'xpt', 1, 'xpt_miss', -1,
    'def_sack', 1, 'def_int', 2, 'def_fum_rec', 2, 'def_td', 6, 'def_st_td', 6,
    'def_safe', 2, 'def_blk_kick', 2,
    'def_pts_allow_0', 10, 'def_pts_allow_1_6', 7, 'def_pts_allow_7_13', 4,
    'def_pts_allow_14_20', 1, 'def_pts_allow_21_27', 0, 'def_pts_allow_28_34', -1, 'def_pts_allow_35p', -4
  )
)
WHERE (scoring_type = 'half_ppr' OR scoring_type IS NULL)
  AND NOT (settings->'scoring' ? 'pass_yd');

-- PPR scoring (rec = 1)
UPDATE leagues
SET settings = jsonb_set(
  settings,
  '{scoring}',
  (settings->'scoring') || jsonb_build_object(
    'pass_yd', 0.04, 'pass_td', 4, 'pass_int', -2, 'pass_2pt', 2,
    'rush_yd', 0.1, 'rush_td', 6, 'rush_2pt', 2,
    'rec', 1, 'rec_yd', 0.1, 'rec_td', 6, 'rec_2pt', 2,
    'fum_lost', -2,
    'fg_0_19', 3, 'fg_20_29', 3, 'fg_30_39', 3, 'fg_40_49', 4, 'fg_50p', 5,
    'xpt', 1, 'xpt_miss', -1,
    'def_sack', 1, 'def_int', 2, 'def_fum_rec', 2, 'def_td', 6, 'def_st_td', 6,
    'def_safe', 2, 'def_blk_kick', 2,
    'def_pts_allow_0', 10, 'def_pts_allow_1_6', 7, 'def_pts_allow_7_13', 4,
    'def_pts_allow_14_20', 1, 'def_pts_allow_21_27', 0, 'def_pts_allow_28_34', -1, 'def_pts_allow_35p', -4
  )
)
WHERE scoring_type = 'ppr'
  AND NOT (settings->'scoring' ? 'pass_yd');
