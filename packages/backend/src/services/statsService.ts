import { query } from '../config/database';
import {
  getSleeperStats,
  getSleeperProjections,
  SleeperPlayerStats,
} from './sleeperService';

// =============================================
// Scoring Settings
// =============================================

/**
 * Per-field scoring multipliers for a fantasy league.
 * Matches the field names in the Sleeper stats response so settings can be
 * stored directly in leagues.settings and applied to raw stat JSONB.
 */
export interface ScoringSettings {
  // Passing
  pass_yd?: number;       // pts per passing yard  (default 0.04 = 1pt/25yd)
  pass_td?: number;       // pts per passing TD     (default 4)
  pass_int?: number;      // pts per interception   (default -2)
  pass_2pt?: number;      // pts per 2pt conversion (default 2)
  // Rushing
  rush_yd?: number;       // pts per rushing yard   (default 0.1 = 1pt/10yd)
  rush_td?: number;       // pts per rushing TD     (default 6)
  rush_2pt?: number;      // pts per 2pt conversion (default 2)
  // Receiving
  rec?: number;           // pts per reception      (0=std, 0.5=half-PPR, 1=PPR)
  rec_yd?: number;        // pts per receiving yard (default 0.1)
  rec_td?: number;        // pts per receiving TD   (default 6)
  rec_2pt?: number;       // pts per 2pt conversion (default 2)
  // General
  fum_lost?: number;      // pts per fumble lost    (default -2)
  // Kicking
  fg_0_19?: number;       // pts for FG 0-19 yards  (default 3)
  fg_20_29?: number;      // pts for FG 20-29 yards (default 3)
  fg_30_39?: number;      // pts for FG 30-39 yards (default 3)
  fg_40_49?: number;      // pts for FG 40-49 yards (default 4)
  fg_50p?: number;        // pts for FG 50+ yards   (default 5)
  xpt?: number;           // pts for XP made        (default 1)
  xpt_miss?: number;      // pts for missed XP      (default -1)
  // Defense / Special Teams
  def_sack?: number;      // pts per sack           (default 1)
  def_int?: number;       // pts per INT            (default 2)
  def_fum_rec?: number;   // pts per fumble recovery(default 2)
  def_td?: number;        // pts per defensive TD   (default 6)
  def_st_td?: number;     // pts per ST TD          (default 6)
  def_safe?: number;      // pts per safety         (default 2)
  def_blk_kick?: number;  // pts per blocked kick   (default 2)
  // Defense: points-allowed tiers
  def_pts_allow_0?: number;     // default 10
  def_pts_allow_1_6?: number;   // default 7
  def_pts_allow_7_13?: number;  // default 4
  def_pts_allow_14_20?: number; // default 1
  def_pts_allow_21_27?: number; // default 0
  def_pts_allow_28_34?: number; // default -1
  def_pts_allow_35p?: number;   // default -4
}

/** PPR scoring — the default used when no league settings are specified. */
export const DEFAULT_SCORING: ScoringSettings = {
  pass_yd: 0.04,
  pass_td: 4,
  pass_int: -2,
  pass_2pt: 2,
  rush_yd: 0.1,
  rush_td: 6,
  rush_2pt: 2,
  rec: 1,
  rec_yd: 0.1,
  rec_td: 6,
  rec_2pt: 2,
  fum_lost: -2,
  fg_0_19: 3,
  fg_20_29: 3,
  fg_30_39: 3,
  fg_40_49: 4,
  fg_50p: 5,
  xpt: 1,
  xpt_miss: -1,
  def_sack: 1,
  def_int: 2,
  def_fum_rec: 2,
  def_td: 6,
  def_st_td: 6,
  def_safe: 2,
  def_blk_kick: 2,
  def_pts_allow_0: 10,
  def_pts_allow_1_6: 7,
  def_pts_allow_7_13: 4,
  def_pts_allow_14_20: 1,
  def_pts_allow_21_27: 0,
  def_pts_allow_28_34: -1,
  def_pts_allow_35p: -4,
};

/** Standard scoring (no reception points). */
export const STANDARD_SCORING: ScoringSettings = { ...DEFAULT_SCORING, rec: 0 };

/** Half-PPR scoring. */
export const HALF_PPR_SCORING: ScoringSettings = { ...DEFAULT_SCORING, rec: 0.5 };

// =============================================
// Fantasy Points Calculator
// =============================================

/** Returns the defense points-allowed bonus based on the scoring tier. */
function defPtsAllowScore(ptsAllow: number, s: ScoringSettings): number {
  if (ptsAllow === 0)  return s.def_pts_allow_0     ?? 10;
  if (ptsAllow <= 6)   return s.def_pts_allow_1_6   ?? 7;
  if (ptsAllow <= 13)  return s.def_pts_allow_7_13  ?? 4;
  if (ptsAllow <= 20)  return s.def_pts_allow_14_20 ?? 1;
  if (ptsAllow <= 27)  return s.def_pts_allow_21_27 ?? 0;
  if (ptsAllow <= 34)  return s.def_pts_allow_28_34 ?? -1;
  return s.def_pts_allow_35p ?? -4;
}

/**
 * Calculate fantasy points for a player's stat line using the given scoring
 * settings. Falls back to DEFAULT_SCORING for any unspecified field.
 *
 * @param stats   Raw stat fields from the Sleeper stats API.
 * @param settings  League scoring settings (partial — missing keys use defaults).
 */
export function calculateFantasyPoints(
  stats: SleeperPlayerStats,
  settings: ScoringSettings = DEFAULT_SCORING
): number {
  const s: ScoringSettings = { ...DEFAULT_SCORING, ...settings };
  let pts = 0;

  // Passing
  pts += (stats.pass_yd  || 0) * s.pass_yd!;
  pts += (stats.pass_td  || 0) * s.pass_td!;
  pts += (stats.pass_int || 0) * s.pass_int!;
  pts += (stats.pass_2pt || 0) * s.pass_2pt!;

  // Rushing
  pts += (stats.rush_yd  || 0) * s.rush_yd!;
  pts += (stats.rush_td  || 0) * s.rush_td!;
  pts += (stats.rush_2pt || 0) * s.rush_2pt!;

  // Receiving
  pts += (stats.rec      || 0) * s.rec!;
  pts += (stats.rec_yd   || 0) * s.rec_yd!;
  pts += (stats.rec_td   || 0) * s.rec_td!;
  pts += (stats.rec_2pt  || 0) * s.rec_2pt!;

  // Fumbles
  pts += (stats.fum_lost || 0) * s.fum_lost!;

  // Kicking
  pts += (stats.fg_0_19  || 0) * s.fg_0_19!;
  pts += (stats.fg_20_29 || 0) * s.fg_20_29!;
  pts += (stats.fg_30_39 || 0) * s.fg_30_39!;
  pts += (stats.fg_40_49 || 0) * s.fg_40_49!;
  pts += (stats.fg_50p   || 0) * s.fg_50p!;
  pts += (stats.xpt      || 0) * s.xpt!;
  pts += (stats.xpt_miss || 0) * s.xpt_miss!;

  // Defense
  pts += (stats.def_sack     || 0) * s.def_sack!;
  pts += (stats.def_int      || 0) * s.def_int!;
  pts += (stats.def_fum_rec  || 0) * s.def_fum_rec!;
  pts += (stats.def_td       || 0) * s.def_td!;
  pts += (stats.def_st_td    || 0) * s.def_st_td!;
  pts += (stats.def_safe     || 0) * s.def_safe!;
  pts += (stats.def_blk_kick || 0) * s.def_blk_kick!;

  if (stats.pts_allow !== undefined) {
    pts += defPtsAllowScore(stats.pts_allow, s);
  }

  return Math.round(pts * 100) / 100;
}

// =============================================
// Stats Sync
// =============================================

export interface StatsSyncResult {
  season: number;
  week: number;
  season_type: string;
  synced: number;
  skipped: number; // player not in local players table
  errors: number;
}

/**
 * Fetch player game stats from Sleeper for a given week and upsert into
 * `player_stats`. Idempotent — re-running updates existing rows.
 * Only inserts rows where the player already exists in the `players` table.
 */
export async function syncPlayerStats(
  season: number,
  week: number,
  seasonType = 'regular'
): Promise<StatsSyncResult> {
  console.log(`[statsService] Syncing stats: ${seasonType} ${season} week ${week}`);

  const [statsMap, projMap] = await Promise.all([
    getSleeperStats(season, week, seasonType),
    getSleeperProjections(season, week, seasonType).catch((err) => {
      console.warn(`[statsService] Projections unavailable for week ${week}:`, (err as Error).message);
      return {} as Record<string, SleeperPlayerStats>;
    }),
  ]);

  const playerIds = Object.keys(statsMap);
  let synced = 0;
  let skipped = 0;
  let errors = 0;

  for (const playerId of playerIds) {
    const stats = statsMap[playerId];
    if (!stats || Object.keys(stats).length === 0) continue;

    const proj = projMap[playerId] || {};

    // Use Sleeper's pre-calculated values when available; fall back to our calculator.
    const ptsStd  = typeof stats.pts_std      === 'number' ? stats.pts_std      : calculateFantasyPoints(stats, STANDARD_SCORING);
    const ptsHalf = typeof stats.pts_half_ppr === 'number' ? stats.pts_half_ppr : calculateFantasyPoints(stats, HALF_PPR_SCORING);
    const ptsPpr  = typeof stats.pts_ppr      === 'number' ? stats.pts_ppr      : calculateFantasyPoints(stats, DEFAULT_SCORING);

    try {
      const { rowCount } = await query(
        `INSERT INTO player_stats
           (player_id, season, week, season_type, stats, projected,
            fantasy_pts_std, fantasy_pts_half, fantasy_pts_ppr, last_synced_at)
         SELECT $1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, NOW()
         WHERE EXISTS (SELECT 1 FROM players WHERE id = $1)
         ON CONFLICT (player_id, season, week, season_type) DO UPDATE SET
           stats            = EXCLUDED.stats,
           projected        = EXCLUDED.projected,
           fantasy_pts_std  = EXCLUDED.fantasy_pts_std,
           fantasy_pts_half = EXCLUDED.fantasy_pts_half,
           fantasy_pts_ppr  = EXCLUDED.fantasy_pts_ppr,
           last_synced_at   = NOW()`,
        [
          playerId,
          season,
          week,
          seasonType,
          JSON.stringify(stats),
          JSON.stringify(proj),
          ptsStd,
          ptsHalf,
          ptsPpr,
        ]
      );

      if ((rowCount ?? 0) > 0) {
        synced++;
      } else {
        skipped++; // player not in our cache — run player master sync first
      }
    } catch (err) {
      console.error(`[statsService] Failed to upsert stats for player ${playerId}:`, err);
      errors++;
    }
  }

  console.log(
    `[statsService] Done — synced: ${synced}, skipped (not in players table): ${skipped}, errors: ${errors}`
  );
  return { season, week, season_type: seasonType, synced, skipped, errors };
}

/**
 * Compute fantasy points for a player's stored stats using custom league scoring.
 * Useful when a league has non-standard settings.
 */
export function applyLeagueScoring(
  rawStats: SleeperPlayerStats,
  leagueScoring: Partial<ScoringSettings>
): number {
  return calculateFantasyPoints(rawStats, { ...DEFAULT_SCORING, ...leagueScoring });
}
