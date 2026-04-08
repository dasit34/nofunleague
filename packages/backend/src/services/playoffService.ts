/**
 * Playoff Service — standings-based seeding, bracket generation, and round advancement.
 */

import { query } from '../config/database';
import type { LeagueSettings } from '../config/leagueSettings';

// =============================================
// Bracket pairings — pure function, no DB
// =============================================

export interface BracketPairings {
  pairings: [number, number][];  // [homeSeed, awaySeed] — higher seed is home
  byes: number[];                // seed numbers that have a first-round bye
}

/**
 * Compute first-round matchup pairings for a given playoff team count.
 * Higher seed is always the home team (first element in each pair).
 */
export function computeFirstRoundPairings(playoffTeams: number): BracketPairings {
  switch (playoffTeams) {
    case 2:
      return { pairings: [[1, 2]], byes: [] };
    case 4:
      return { pairings: [[1, 4], [2, 3]], byes: [] };
    case 6:
      // Seeds 1-2 get byes; only 3v6, 4v5 play in round 1
      return { pairings: [[3, 6], [4, 5]], byes: [1, 2] };
    case 8:
      return { pairings: [[1, 8], [2, 7], [3, 6], [4, 5]], byes: [] };
    default:
      throw new Error(`Invalid playoff team count: ${playoffTeams}. Must be 2, 4, 6, or 8.`);
  }
}

// =============================================
// Seeding from standings
// =============================================

export interface PlayoffSeed {
  seed: number;
  teamId: string;
}

/**
 * Get playoff seedings from current standings.
 * Order: wins DESC, points_for DESC, name ASC (deterministic tiebreak).
 */
export async function getPlayoffSeedings(
  leagueId: string,
  playoffTeamCount: number,
): Promise<PlayoffSeed[]> {
  const { rows } = await query(
    `SELECT id FROM teams
     WHERE league_id = $1
     ORDER BY wins DESC, points_for DESC, name ASC
     LIMIT $2`,
    [leagueId, playoffTeamCount],
  );

  return rows.map((row: { id: string }, index: number) => ({
    seed: index + 1,
    teamId: row.id,
  }));
}

/**
 * Round down to the nearest valid bracket size.
 */
function nearestValidBracketSize(n: number): number {
  if (n >= 8) return 8;
  if (n >= 6) return 6;
  if (n >= 4) return 4;
  if (n >= 2) return 2;
  return 0;
}

// =============================================
// First-round bracket generation
// =============================================

export interface GeneratedBracket {
  matchups: {
    week: number;
    homeSeed: number;
    awaySeed: number;
    homeTeamId: string;
    awayTeamId: string;
  }[];
  byes: PlayoffSeed[];
  playoffTeams: number;
}

/**
 * Generate first-round playoff matchups and insert them into the matchups table.
 * Idempotent — exits early if playoff matchups already exist for the start week.
 */
export async function generateFirstRoundBracket(
  leagueId: string,
  settings: LeagueSettings,
): Promise<GeneratedBracket> {
  const playoffStartWeek = settings.season.playoff_start_week;
  let playoffTeamCount = settings.playoffs.teams;

  if (playoffTeamCount <= 0) {
    return { matchups: [], byes: [], playoffTeams: 0 };
  }

  // Check if playoff matchups already exist (idempotent)
  const { rows: existing } = await query(
    'SELECT id FROM matchups WHERE league_id = $1 AND week = $2 AND is_playoffs = TRUE LIMIT 1',
    [leagueId, playoffStartWeek],
  );
  if (existing.length > 0) {
    return { matchups: [], byes: [], playoffTeams: playoffTeamCount };
  }

  // Get actual team count and cap playoff teams if needed
  const { rows: [{ count: actualTeamCount }] } = await query(
    'SELECT COUNT(*)::int AS count FROM teams WHERE league_id = $1',
    [leagueId],
  );
  if ((actualTeamCount as number) < playoffTeamCount) {
    playoffTeamCount = nearestValidBracketSize(actualTeamCount as number);
  }
  if (playoffTeamCount < 2) {
    return { matchups: [], byes: [], playoffTeams: 0 };
  }

  // Get seedings from standings
  const seedings = await getPlayoffSeedings(leagueId, playoffTeamCount);
  if (seedings.length < 2) {
    return { matchups: [], byes: [], playoffTeams: 0 };
  }

  // Compute bracket pairings
  const { pairings, byes: byeSeeds } = computeFirstRoundPairings(playoffTeamCount);

  // Build seed-to-team map
  const seedMap = new Map<number, string>();
  for (const s of seedings) {
    seedMap.set(s.seed, s.teamId);
  }

  // Determine weeks to insert (1 or 2 depending on weeks_per_round)
  const weeksPerRound = settings.playoffs.weeks_per_round;
  const weeks = [playoffStartWeek];
  if (weeksPerRound === 2) {
    weeks.push(playoffStartWeek + 1);
  }

  // Insert matchups
  const generatedMatchups: GeneratedBracket['matchups'] = [];

  for (const week of weeks) {
    for (const [homeSeed, awaySeed] of pairings) {
      const homeTeamId = seedMap.get(homeSeed);
      const awayTeamId = seedMap.get(awaySeed);
      if (!homeTeamId || !awayTeamId) continue;

      await query(
        `INSERT INTO matchups (league_id, week, home_team_id, away_team_id, is_playoffs)
         VALUES ($1, $2, $3, $4, TRUE)
         ON CONFLICT DO NOTHING`,
        [leagueId, week, homeTeamId, awayTeamId],
      );

      generatedMatchups.push({
        week,
        homeSeed,
        awaySeed,
        homeTeamId,
        awayTeamId,
      });
    }
  }

  // Collect bye teams
  const byeTeams: PlayoffSeed[] = byeSeeds
    .map(seed => ({ seed, teamId: seedMap.get(seed) ?? '' }))
    .filter(b => b.teamId !== '');

  console.log(
    `[Playoffs] Generated first-round bracket for league ${leagueId}: ` +
    `${generatedMatchups.length} matchups, ${byeTeams.length} byes, ` +
    `${playoffTeamCount} playoff teams, week ${playoffStartWeek}`
  );

  return {
    matchups: generatedMatchups,
    byes: byeTeams,
    playoffTeams: playoffTeamCount,
  };
}

// =============================================
// Playoff advancement — Phase 5B
// =============================================

export interface AdvancementResult {
  /** 'advanced' = next round generated, 'champion' = season over, 'waiting' = not all matchups scored yet, 'none' = no playoff matchups */
  outcome: 'advanced' | 'champion' | 'waiting' | 'none';
  championTeamId?: string;
  nextRoundMatchups?: { homeTeamId: string; awayTeamId: string; week: number }[];
  message: string;
}

/**
 * After a playoff week is scored, check if the round is complete and advance.
 *
 * Logic:
 * 1. Find all playoff matchups for the just-scored week.
 * 2. If weeks_per_round=2 and this is the first week of a round, do nothing (wait for week 2).
 * 3. Determine winners (by score, higher seed wins ties).
 * 4. Collect bye teams if this was round 1 of a 6-team playoff.
 * 5. If only 1 winner remains and no byes, that's the champion → complete.
 * 6. Otherwise pair winners for next round and insert matchups.
 */
export async function advancePlayoffRound(
  leagueId: string,
  scoredWeek: number,
  settings: LeagueSettings,
): Promise<AdvancementResult> {
  const weeksPerRound = settings.playoffs.weeks_per_round;
  const playoffStartWeek = settings.season.playoff_start_week;

  // Get all playoff matchups for this week
  const { rows: weekMatchups } = await query(
    `SELECT * FROM matchups
     WHERE league_id = $1 AND week = $2 AND is_playoffs = TRUE`,
    [leagueId, scoredWeek],
  );

  if (weekMatchups.length === 0) {
    return { outcome: 'none', message: 'No playoff matchups for this week.' };
  }

  // Check if all matchups for this week are complete
  const allComplete = weekMatchups.every((m: { is_complete: boolean }) => m.is_complete);
  if (!allComplete) {
    return { outcome: 'waiting', message: 'Not all playoff matchups are scored yet.' };
  }

  // For 2-week rounds: determine if this is week 1 or week 2 of the round
  if (weeksPerRound === 2) {
    // Rounds start at playoffStartWeek. Each round spans 2 weeks.
    // Round 1: weeks [start, start+1], Round 2: weeks [start+2, start+3], etc.
    const weeksIntoBracket = scoredWeek - playoffStartWeek; // 0-indexed
    const isSecondWeekOfRound = weeksIntoBracket % 2 === 1;

    if (!isSecondWeekOfRound) {
      // First week of round — wait for second week
      return { outcome: 'waiting', message: 'First week of 2-week round scored. Waiting for second week.' };
    }

    // This is the second week — determine winners by total score across both weeks
    const firstWeek = scoredWeek - 1;
    return advanceFromTwoWeekRound(leagueId, firstWeek, scoredWeek, settings);
  }

  // Single-week round — determine winners directly
  return advanceFromScoredMatchups(leagueId, weekMatchups, scoredWeek, settings);
}

/**
 * Advance from single-week scored matchups.
 */
async function advanceFromScoredMatchups(
  leagueId: string,
  matchups: Record<string, unknown>[],
  scoredWeek: number,
  settings: LeagueSettings,
): Promise<AdvancementResult> {
  const playoffStartWeek = settings.season.playoff_start_week;
  const playoffTeamCount = settings.playoffs.teams;

  // Get seedings to know which team is higher seed
  const seedings = await getPlayoffSeedings(leagueId, playoffTeamCount);
  const teamToSeed = new Map<string, number>();
  for (const s of seedings) teamToSeed.set(s.teamId, s.seed);

  // Determine winners — higher seed wins ties
  const winners: { teamId: string; seed: number }[] = [];
  for (const m of matchups) {
    const homeId = m.home_team_id as string;
    const awayId = m.away_team_id as string;
    const winnerId = m.winner_team_id as string | null;

    let advancingId: string;
    if (winnerId) {
      advancingId = winnerId;
    } else {
      // Tie: higher seed (lower number) advances
      const homeSeed = teamToSeed.get(homeId) ?? 999;
      const awaySeed = teamToSeed.get(awayId) ?? 999;
      advancingId = homeSeed <= awaySeed ? homeId : awayId;
    }

    winners.push({
      teamId: advancingId,
      seed: teamToSeed.get(advancingId) ?? 999,
    });
  }

  // Collect bye teams for round 1 of 6-team brackets
  const byeTeams = await getByeTeamsForRound(leagueId, scoredWeek, settings, seedings);

  // Combine winners + bye teams
  const advancingTeams = [...winners, ...byeTeams].sort((a, b) => a.seed - b.seed);

  // Championship check: if only 1 matchup was played AND no bye teams, this was the final
  if (advancingTeams.length <= 1) {
    // This shouldn't happen in a properly formed bracket (you need at least 2 to make a matchup)
    // But just in case: the one advancing team is champion
    const champion = advancingTeams[0];
    return {
      outcome: 'champion',
      championTeamId: champion?.teamId,
      message: champion ? 'Champion determined!' : 'Bracket error — no advancing team.',
    };
  }

  if (advancingTeams.length === 2) {
    // Only 2 teams left — next round is the championship
    // After this round is scored, winner will be champion
  }

  // Generate next-round matchups: pair by bracket position (1st vs last, 2nd vs 2nd-last, etc.)
  // This naturally preserves bracket halves:
  // From [seed1, seed2, seed4_winner, seed3_winner] sorted → pairs correctly
  const nextRoundWeek = scoredWeek + 1;
  const nextMatchups: { homeTeamId: string; awayTeamId: string; week: number }[] = [];

  // Check if next round already exists (idempotent)
  const { rows: existingNext } = await query(
    'SELECT id FROM matchups WHERE league_id = $1 AND week = $2 AND is_playoffs = TRUE LIMIT 1',
    [leagueId, nextRoundWeek],
  );
  if (existingNext.length > 0) {
    return { outcome: 'advanced', nextRoundMatchups: [], message: 'Next round already generated.' };
  }

  // Pair advancing teams: first vs last, second vs second-to-last
  for (let i = 0; i < Math.floor(advancingTeams.length / 2); i++) {
    const home = advancingTeams[i];                              // higher seed
    const away = advancingTeams[advancingTeams.length - 1 - i];  // lower seed

    const weeks = [nextRoundWeek];
    if (settings.playoffs.weeks_per_round === 2) {
      weeks.push(nextRoundWeek + 1);
    }

    for (const w of weeks) {
      await query(
        `INSERT INTO matchups (league_id, week, home_team_id, away_team_id, is_playoffs)
         VALUES ($1, $2, $3, $4, TRUE)
         ON CONFLICT DO NOTHING`,
        [leagueId, w, home.teamId, away.teamId],
      );
      nextMatchups.push({ homeTeamId: home.teamId, awayTeamId: away.teamId, week: w });
    }
  }

  console.log(`[Playoffs] Advanced: ${nextMatchups.length} matchups generated for week ${nextRoundWeek}`);

  // Check if the just-generated round is the championship (2 teams → 1 matchup)
  const isChampionshipNext = advancingTeams.length === 2;

  return {
    outcome: 'advanced',
    nextRoundMatchups: nextMatchups,
    message: isChampionshipNext
      ? `Championship matchup set for week ${nextRoundWeek}.`
      : `${nextMatchups.length} next-round matchups generated for week ${nextRoundWeek}.`,
  };
}

/**
 * Advance from a 2-week round by summing scores across both weeks.
 */
async function advanceFromTwoWeekRound(
  leagueId: string,
  firstWeek: number,
  secondWeek: number,
  settings: LeagueSettings,
): Promise<AdvancementResult> {
  // Get matchups from both weeks
  const { rows: week1 } = await query(
    'SELECT * FROM matchups WHERE league_id = $1 AND week = $2 AND is_playoffs = TRUE',
    [leagueId, firstWeek],
  );
  const { rows: week2 } = await query(
    'SELECT * FROM matchups WHERE league_id = $1 AND week = $2 AND is_playoffs = TRUE',
    [leagueId, secondWeek],
  );

  // Both weeks must be complete
  const allComplete = [...week1, ...week2].every((m: { is_complete: boolean }) => m.is_complete);
  if (!allComplete) {
    return { outcome: 'waiting', message: 'Not all 2-week round matchups are scored yet.' };
  }

  // Build combined scores per pairing (keyed by sorted team IDs)
  const pairingScores = new Map<string, { homeId: string; awayId: string; homeTotal: number; awayTotal: number }>();

  for (const m of [...week1, ...week2]) {
    const homeId = m.home_team_id as string;
    const awayId = m.away_team_id as string;
    const key = [homeId, awayId].sort().join(':');

    const existing = pairingScores.get(key) ?? { homeId, awayId, homeTotal: 0, awayTotal: 0 };
    existing.homeTotal += Number(m.home_score) || 0;
    existing.awayTotal += Number(m.away_score) || 0;
    pairingScores.set(key, existing);
  }

  // Build synthetic matchups with combined scores for the advancement logic
  const combinedMatchups: Record<string, unknown>[] = [];
  for (const { homeId, awayId, homeTotal, awayTotal } of pairingScores.values()) {
    let winnerId: string | null = null;
    if (homeTotal > awayTotal) winnerId = homeId;
    else if (awayTotal > homeTotal) winnerId = awayId;
    // Tie: winner_team_id stays null — advanceFromScoredMatchups handles it (higher seed wins)

    combinedMatchups.push({
      home_team_id: homeId,
      away_team_id: awayId,
      home_score: homeTotal,
      away_score: awayTotal,
      winner_team_id: winnerId,
      is_playoffs: true,
    });
  }

  return advanceFromScoredMatchups(leagueId, combinedMatchups, secondWeek, settings);
}

/**
 * Get bye teams for the current round (only applicable for round 1 of 6-team playoffs).
 */
async function getByeTeamsForRound(
  leagueId: string,
  scoredWeek: number,
  settings: LeagueSettings,
  seedings: PlayoffSeed[],
): Promise<{ teamId: string; seed: number }[]> {
  const playoffStartWeek = settings.season.playoff_start_week;
  const weeksPerRound = settings.playoffs.weeks_per_round;
  const playoffTeamCount = settings.playoffs.teams;

  // Byes only exist in 6-team playoffs, round 1
  if (playoffTeamCount !== 6) return [];

  // Determine if this is round 1
  // Round 1 ends at: playoffStartWeek (1-week) or playoffStartWeek+1 (2-week)
  const round1EndWeek = playoffStartWeek + weeksPerRound - 1;
  if (scoredWeek !== round1EndWeek) return [];

  // Seeds 1 and 2 have byes
  return seedings
    .filter(s => s.seed <= 2)
    .map(s => ({ teamId: s.teamId, seed: s.seed }));
}

/**
 * Check if the just-scored playoff week was the championship.
 * If the winner is determined, return the champion team ID.
 */
export async function checkForChampion(
  leagueId: string,
  scoredWeek: number,
  settings: LeagueSettings,
): Promise<{ isChampionship: boolean; championTeamId: string | null }> {
  const weeksPerRound = settings.playoffs.weeks_per_round;

  // For 2-week rounds, only check on the second week
  if (weeksPerRound === 2) {
    const playoffStartWeek = settings.season.playoff_start_week;
    const weeksIntoBracket = scoredWeek - playoffStartWeek;
    if (weeksIntoBracket % 2 === 0) {
      return { isChampionship: false, championTeamId: null };
    }
  }

  // Get scored playoff matchups for this week
  const { rows: matchups } = await query(
    `SELECT * FROM matchups WHERE league_id = $1 AND week = $2 AND is_playoffs = TRUE AND is_complete = TRUE`,
    [leagueId, scoredWeek],
  );

  if (matchups.length !== 1) {
    return { isChampionship: false, championTeamId: null };
  }

  // Check if there are any future playoff matchups
  const { rows: futureMatchups } = await query(
    'SELECT id FROM matchups WHERE league_id = $1 AND week > $2 AND is_playoffs = TRUE LIMIT 1',
    [leagueId, scoredWeek],
  );

  if (futureMatchups.length > 0) {
    return { isChampionship: false, championTeamId: null };
  }

  // This was the only matchup and no future matchups exist — it's the championship
  const m = matchups[0];
  let championId = m.winner_team_id as string | null;

  // Handle tie in championship (higher seed wins)
  if (!championId) {
    const seedings = await getPlayoffSeedings(leagueId, settings.playoffs.teams);
    const teamToSeed = new Map<string, number>();
    for (const s of seedings) teamToSeed.set(s.teamId, s.seed);

    const homeSeed = teamToSeed.get(m.home_team_id as string) ?? 999;
    const awaySeed = teamToSeed.get(m.away_team_id as string) ?? 999;
    championId = homeSeed <= awaySeed ? m.home_team_id as string : m.away_team_id as string;
  }

  return { isChampionship: true, championTeamId: championId };
}
