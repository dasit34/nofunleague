/**
 * Scoring service — computes and persists team/player scores.
 *
 * For preset scoring types (standard/half_ppr/ppr), reads pre-calculated
 * fantasy point columns for performance.
 *
 * For custom scoring, uses calculateFantasyPoints() with raw stats and
 * the league's per-stat point values from settings.
 *
 * All scored data is persisted to player_weekly_scores (per-player)
 * and weekly_scores (per-team summary).
 */
import { query } from '../config/database';
import { getSettings } from './settingsService';
import { type ScoringSettings } from '../config/leagueSettings';
import { calculateFantasyPoints } from './statsService';

// =============================================
// Types
// =============================================

export interface PlayerScore {
  playerId: string;
  points: number;
  isStarter: boolean;
  statBreakdown: Record<string, number>;  // { pass_yd: 12.0, pass_td: 8, ... }
}

export interface TeamScoreResult {
  total: number;
  playerScores: PlayerScore[];
}

// =============================================
// Scoring column mapping (preset fast path)
// =============================================

function scoringColumn(scoringType: string): string {
  switch (scoringType) {
    case 'standard':  return 'fantasy_pts_std';
    case 'ppr':       return 'fantasy_pts_ppr';
    case 'half_ppr':
    default:          return 'fantasy_pts_half';
  }
}

// =============================================
// Calculate team score
// =============================================

/**
 * Calculate a team's total score for a given week using real player stats.
 * Returns per-player points and stat breakdowns.
 */
export async function calculateRealTeamScore(
  teamId: string,
  season: number,
  week: number,
  scoringSettings: ScoringSettings
): Promise<TeamScoreResult> {
  const isCustom = scoringSettings.type === 'custom';

  // Fetch starters with raw stats (needed for custom scoring and stat breakdowns)
  const { rows } = await query(
    `SELECT r.player_id, r.is_starter, ps.stats,
            COALESCE(ps.fantasy_pts_std, 0) AS pts_std,
            COALESCE(ps.fantasy_pts_half, 0) AS pts_half,
            COALESCE(ps.fantasy_pts_ppr, 0) AS pts_ppr
     FROM rosters r
     LEFT JOIN player_stats ps
       ON ps.player_id = r.player_id
      AND ps.season = $2
      AND ps.week = $3
      AND ps.season_type = 'regular'
     WHERE r.team_id = $1
       AND r.is_starter = TRUE`,
    [teamId, season, week]
  );

  const playerScores: PlayerScore[] = rows.map((r: {
    player_id: string;
    is_starter: boolean;
    stats: Record<string, number> | null;
    pts_std: string;
    pts_half: string;
    pts_ppr: string;
  }) => {
    let points: number;
    let statBreakdown: Record<string, number> = {};

    if (isCustom && r.stats) {
      // Custom scoring: calculate from raw stats
      points = calculateFantasyPoints(r.stats, scoringSettings);
      statBreakdown = buildStatBreakdown(r.stats, scoringSettings);
    } else if (r.stats) {
      // Preset scoring with raw stats available: use pre-calculated column + build breakdown
      const col = scoringSettings.type === 'standard' ? 'pts_std'
                : scoringSettings.type === 'ppr' ? 'pts_ppr'
                : 'pts_half';
      points = parseFloat(r[col as keyof typeof r] as string) || 0;
      statBreakdown = buildStatBreakdown(r.stats, scoringSettings);
    } else {
      // No stats available
      const col = scoringSettings.type === 'standard' ? 'pts_std'
                : scoringSettings.type === 'ppr' ? 'pts_ppr'
                : 'pts_half';
      points = parseFloat(r[col as keyof typeof r] as string) || 0;
    }

    return {
      playerId: r.player_id,
      points: Math.round(points * 100) / 100,
      isStarter: true,
      statBreakdown,
    };
  });

  const total = Math.round(playerScores.reduce((sum, p) => sum + p.points, 0) * 100) / 100;
  return { total, playerScores };
}

/**
 * Build a stat breakdown showing the point contribution of each stat category.
 */
function buildStatBreakdown(
  stats: Record<string, number>,
  settings: ScoringSettings,
): Record<string, number> {
  const breakdown: Record<string, number> = {};
  const add = (key: string, statVal: number, multiplier: number) => {
    const contribution = Math.round(statVal * multiplier * 100) / 100;
    if (contribution !== 0) breakdown[key] = contribution;
  };

  add('pass_yd',  stats.pass_yd  || 0, settings.pass_yd);
  add('pass_td',  stats.pass_td  || 0, settings.pass_td);
  add('pass_int', stats.pass_int || 0, settings.pass_int);
  add('pass_2pt', stats.pass_2pt || 0, settings.pass_2pt);
  add('rush_yd',  stats.rush_yd  || 0, settings.rush_yd);
  add('rush_td',  stats.rush_td  || 0, settings.rush_td);
  add('rush_2pt', stats.rush_2pt || 0, settings.rush_2pt);
  add('rec',      stats.rec      || 0, settings.rec);
  add('rec_yd',   stats.rec_yd   || 0, settings.rec_yd);
  add('rec_td',   stats.rec_td   || 0, settings.rec_td);
  add('rec_2pt',  stats.rec_2pt  || 0, settings.rec_2pt);
  add('fum_lost', stats.fum_lost || 0, settings.fum_lost);
  add('fg_0_19',  stats.fg_0_19  || 0, settings.fg_0_19);
  add('fg_20_29', stats.fg_20_29 || 0, settings.fg_20_29);
  add('fg_30_39', stats.fg_30_39 || 0, settings.fg_30_39);
  add('fg_40_49', stats.fg_40_49 || 0, settings.fg_40_49);
  add('fg_50p',   stats.fg_50p   || 0, settings.fg_50p);
  add('xpt',      stats.xpt      || 0, settings.xpt);
  add('xpt_miss', stats.xpt_miss || 0, settings.xpt_miss);
  add('def_sack',     stats.def_sack     || 0, settings.def_sack);
  add('def_int',      stats.def_int      || 0, settings.def_int);
  add('def_fum_rec',  stats.def_fum_rec  || 0, settings.def_fum_rec);
  add('def_td',       stats.def_td       || 0, settings.def_td);
  add('def_st_td',    stats.def_st_td    || 0, settings.def_st_td);
  add('def_safe',     stats.def_safe     || 0, settings.def_safe);
  add('def_blk_kick', stats.def_blk_kick || 0, settings.def_blk_kick);

  return breakdown;
}

// =============================================
// Persistence
// =============================================

/**
 * Persist per-player and team-level weekly scores.
 * Idempotent — uses upsert (ON CONFLICT DO UPDATE).
 */
export async function persistWeeklyScores(
  leagueId: string,
  week: number,
  teamId: string,
  playerScores: PlayerScore[],
): Promise<void> {
  const total = Math.round(playerScores.reduce((sum, p) => sum + p.points, 0) * 100) / 100;

  // Per-player rows in player_weekly_scores
  for (const ps of playerScores) {
    await query(
      `INSERT INTO player_weekly_scores (league_id, team_id, player_id, week, points, is_starter, stat_breakdown)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (league_id, team_id, player_id, week) DO UPDATE SET
         points = EXCLUDED.points,
         is_starter = EXCLUDED.is_starter,
         stat_breakdown = EXCLUDED.stat_breakdown,
         updated_at = NOW()`,
      [leagueId, teamId, ps.playerId, week, ps.points, ps.isStarter, JSON.stringify(ps.statBreakdown)]
    );
  }

  // Find highest scorer and biggest bust among starters
  const starters = playerScores.filter(p => p.isStarter);
  const highestScorer = starters.length > 0
    ? starters.reduce((a, b) => b.points > a.points ? b : a)
    : null;
  const biggestBust = starters.filter(p => p.points > 0).length > 0
    ? starters.filter(p => p.points > 0).reduce((a, b) => b.points < a.points ? b : a)
    : null;

  // Team-level row in weekly_scores
  const playerScoresJson = starters.map(p => ({
    player_id: p.playerId,
    points: p.points,
    is_starter: p.isStarter,
  }));

  await query(
    `INSERT INTO weekly_scores (team_id, league_id, week, total_points, player_scores, highest_scorer_id, biggest_bust_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (team_id, week) DO UPDATE SET
       total_points = EXCLUDED.total_points,
       player_scores = EXCLUDED.player_scores,
       highest_scorer_id = EXCLUDED.highest_scorer_id,
       biggest_bust_id = EXCLUDED.biggest_bust_id,
       updated_at = NOW()`,
    [teamId, leagueId, week, total, JSON.stringify(playerScoresJson),
     highestScorer?.playerId ?? null, biggestBust?.playerId ?? null]
  );
}

// =============================================
// Score a full week (real stats)
// =============================================

/**
 * Score all matchups for a league/week using real stats.
 * Persists per-player and team-level scores.
 */
export async function scoreWeekReal(
  leagueId: string,
  week: number
): Promise<{ scored: number; details: { matchupId: string; homeScore: number; awayScore: number; winnerId: string | null }[] }> {
  const { rows: [league] } = await query(
    'SELECT season FROM leagues WHERE id = $1',
    [leagueId]
  );
  if (!league) throw new Error('League not found');

  const season = league.season as number;
  const settings = await getSettings(leagueId);
  const scoringSettings = settings.scoring;

  const { rows: matchups } = await query(
    `SELECT * FROM matchups WHERE league_id = $1 AND week = $2 AND is_complete = FALSE`,
    [leagueId, week]
  );

  const details: { matchupId: string; homeScore: number; awayScore: number; winnerId: string | null }[] = [];

  for (const matchup of matchups) {
    const home = await calculateRealTeamScore(matchup.home_team_id, season, week, scoringSettings);
    const away = await calculateRealTeamScore(matchup.away_team_id, season, week, scoringSettings);

    let winnerId: string | null = null;
    if (home.total > away.total) winnerId = matchup.home_team_id;
    else if (away.total > home.total) winnerId = matchup.away_team_id;

    // Update matchup
    await query(
      `UPDATE matchups
       SET home_score = $1, away_score = $2, winner_team_id = $3,
           is_complete = TRUE, scoring_source = 'real', updated_at = NOW()
       WHERE id = $4`,
      [home.total, away.total, winnerId, matchup.id]
    );

    // Persist weekly scores for both teams
    await persistWeeklyScores(leagueId, week, matchup.home_team_id, home.playerScores);
    await persistWeeklyScores(leagueId, week, matchup.away_team_id, away.playerScores);

    // Update team records — only for regular season (not playoffs)
    if (!matchup.is_playoffs) {
      if (winnerId) {
        const loserId = winnerId === matchup.home_team_id ? matchup.away_team_id : matchup.home_team_id;
        await query('UPDATE teams SET wins = wins + 1, updated_at = NOW() WHERE id = $1', [winnerId]);
        await query('UPDATE teams SET losses = losses + 1, updated_at = NOW() WHERE id = $1', [loserId]);
      } else {
        await query('UPDATE teams SET ties = ties + 1, updated_at = NOW() WHERE id = $1', [matchup.home_team_id]);
        await query('UPDATE teams SET ties = ties + 1, updated_at = NOW() WHERE id = $1', [matchup.away_team_id]);
      }

      await query(
        'UPDATE teams SET points_for = points_for + $2, points_against = points_against + $3, updated_at = NOW() WHERE id = $1',
        [matchup.home_team_id, home.total, away.total]
      );
      await query(
        'UPDATE teams SET points_for = points_for + $2, points_against = points_against + $3, updated_at = NOW() WHERE id = $1',
        [matchup.away_team_id, away.total, home.total]
      );
    }

    details.push({ matchupId: matchup.id, homeScore: home.total, awayScore: away.total, winnerId });
  }

  return { scored: details.length, details };
}

// =============================================
// Query helpers
// =============================================

/**
 * Get a team's weekly score with per-player breakdown.
 */
export async function getTeamWeeklyScore(
  leagueId: string,
  week: number,
  teamId: string,
): Promise<{ total: number; players: { playerId: string; points: number; isStarter: boolean; statBreakdown: Record<string, number> }[] } | null> {
  const { rows } = await query(
    `SELECT pws.player_id, pws.points, pws.is_starter, pws.stat_breakdown,
            p.full_name, p.position, p.nfl_team
     FROM player_weekly_scores pws
     JOIN players p ON p.id = pws.player_id
     WHERE pws.league_id = $1 AND pws.week = $2 AND pws.team_id = $3
     ORDER BY pws.is_starter DESC, pws.points DESC`,
    [leagueId, week, teamId]
  );

  if (rows.length === 0) return null;

  const players = rows.map((r: { player_id: string; points: string; is_starter: boolean; stat_breakdown: Record<string, number> }) => ({
    playerId: r.player_id,
    points: parseFloat(r.points) || 0,
    isStarter: r.is_starter,
    statBreakdown: r.stat_breakdown || {},
  }));

  const total = Math.round(players.filter(p => p.isStarter).reduce((sum, p) => sum + p.points, 0) * 100) / 100;
  return { total, players };
}

/**
 * Get all matchup scores with per-team player breakdowns for a week.
 */
export async function getMatchupScores(
  leagueId: string,
  week: number,
): Promise<{
  matchupId: string;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number;
  awayScore: number;
  winnerId: string | null;
  isPlayoffs: boolean;
  isComplete: boolean;
}[]> {
  const { rows } = await query(
    `SELECT id, home_team_id, away_team_id, home_score, away_score,
            winner_team_id, is_playoffs, is_complete
     FROM matchups
     WHERE league_id = $1 AND week = $2
     ORDER BY created_at`,
    [leagueId, week]
  );

  return rows.map((r: {
    id: string; home_team_id: string; away_team_id: string;
    home_score: string; away_score: string; winner_team_id: string | null;
    is_playoffs: boolean; is_complete: boolean;
  }) => ({
    matchupId: r.id,
    homeTeamId: r.home_team_id,
    awayTeamId: r.away_team_id,
    homeScore: parseFloat(r.home_score) || 0,
    awayScore: parseFloat(r.away_score) || 0,
    winnerId: r.winner_team_id,
    isPlayoffs: r.is_playoffs,
    isComplete: r.is_complete,
  }));
}
