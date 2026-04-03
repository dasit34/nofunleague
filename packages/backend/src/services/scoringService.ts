/**
 * Scoring service — computes real team scores from player_stats.
 *
 * Reads each team's starters, looks up their weekly fantasy points
 * from the player_stats table, and sums them according to the
 * league's scoring_type (standard / half_ppr / ppr).
 */
import { query } from '../config/database';

/**
 * Map league scoring_type to the correct player_stats column.
 */
function scoringColumn(scoringType: string): string {
  switch (scoringType) {
    case 'standard':  return 'fantasy_pts_std';
    case 'ppr':       return 'fantasy_pts_ppr';
    case 'half_ppr':
    default:          return 'fantasy_pts_half';
  }
}

/**
 * Calculate a team's total score for a given week using real player stats.
 * Only starters count. Players with no stats entry score 0.
 */
export async function calculateRealTeamScore(
  teamId: string,
  season: number,
  week: number,
  scoringType: string
): Promise<{ total: number; playerScores: { playerId: string; points: number }[] }> {
  const col = scoringColumn(scoringType);

  // Get starters with their weekly points
  const { rows } = await query(
    `SELECT r.player_id,
            COALESCE(ps.${col}, 0) AS points
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

  const playerScores = rows.map((r: { player_id: string; points: string }) => ({
    playerId: r.player_id,
    points: parseFloat(r.points) || 0,
  }));

  const total = Math.round(playerScores.reduce((sum, p) => sum + p.points, 0) * 100) / 100;

  return { total, playerScores };
}

/**
 * Score all matchups for a league/week using real stats.
 * Returns summary of what was scored.
 */
export async function scoreWeekReal(
  leagueId: string,
  week: number
): Promise<{ scored: number; details: { matchupId: string; homeScore: number; awayScore: number; winnerId: string | null }[] }> {
  // Get league info
  const { rows: [league] } = await query(
    'SELECT season, scoring_type FROM leagues WHERE id = $1',
    [leagueId]
  );
  if (!league) throw new Error('League not found');

  const season = league.season as number;
  const scoringType = (league.scoring_type as string) || 'half_ppr';

  // Get unscored matchups for this week
  const { rows: matchups } = await query(
    `SELECT * FROM matchups WHERE league_id = $1 AND week = $2 AND is_complete = FALSE`,
    [leagueId, week]
  );

  const details: { matchupId: string; homeScore: number; awayScore: number; winnerId: string | null }[] = [];

  for (const matchup of matchups) {
    const home = await calculateRealTeamScore(matchup.home_team_id, season, week, scoringType);
    const away = await calculateRealTeamScore(matchup.away_team_id, season, week, scoringType);

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

    // Update team records
    if (winnerId) {
      const loserId = winnerId === matchup.home_team_id ? matchup.away_team_id : matchup.home_team_id;
      await query('UPDATE teams SET wins = wins + 1, updated_at = NOW() WHERE id = $1', [winnerId]);
      await query('UPDATE teams SET losses = losses + 1, updated_at = NOW() WHERE id = $1', [loserId]);
    } else {
      await query('UPDATE teams SET ties = ties + 1, updated_at = NOW() WHERE id = $1', [matchup.home_team_id]);
      await query('UPDATE teams SET ties = ties + 1, updated_at = NOW() WHERE id = $1', [matchup.away_team_id]);
    }

    // Update points for/against
    await query(
      'UPDATE teams SET points_for = points_for + $2, points_against = points_against + $3, updated_at = NOW() WHERE id = $1',
      [matchup.home_team_id, home.total, away.total]
    );
    await query(
      'UPDATE teams SET points_for = points_for + $2, points_against = points_against + $3, updated_at = NOW() WHERE id = $1',
      [matchup.away_team_id, away.total, home.total]
    );

    details.push({ matchupId: matchup.id, homeScore: home.total, awayScore: away.total, winnerId });
  }

  return { scored: details.length, details };
}
