/**
 * Sleeper API provider — implements FantasyDataProvider.
 *
 * Wraps the existing sleeperService functions and normalizes
 * their output into provider-neutral types.
 */
import {
  syncPlayersFromSleeper,
  getSleeperStats,
} from '../../services/sleeperService';
import {
  calculateFantasyPoints,
  STANDARD_SCORING,
  HALF_PPR_SCORING,
  DEFAULT_SCORING,
} from '../../services/statsService';
import type {
  FantasyDataProvider,
  NormalizedPlayer,
  NormalizedWeekStats,
} from './types';

export const sleeperProvider: FantasyDataProvider = {
  name: 'sleeper',

  async fetchPlayers(): Promise<NormalizedPlayer[]> {
    // The existing sync writes directly to DB and returns count.
    // For the provider interface we return an empty array — callers
    // should use syncPlayersFromSleeper() directly for DB writes.
    await syncPlayersFromSleeper();
    return [];
  },

  async fetchWeekStats(season: number, week: number, seasonType = 'regular'): Promise<NormalizedWeekStats[]> {
    const statsMap = await getSleeperStats(season, week, seasonType);
    const results: NormalizedWeekStats[] = [];

    for (const [playerId, raw] of Object.entries(statsMap)) {
      if (!raw || typeof raw !== 'object') continue;

      const ptsStd  = raw.pts_std  ?? calculateFantasyPoints(raw, STANDARD_SCORING);
      const ptsHalf = raw.pts_half_ppr ?? calculateFantasyPoints(raw, HALF_PPR_SCORING);
      const ptsPpr  = raw.pts_ppr  ?? calculateFantasyPoints(raw, DEFAULT_SCORING);

      // Extract numeric stats only for raw storage
      const numericStats: Record<string, number> = {};
      for (const [k, v] of Object.entries(raw)) {
        if (typeof v === 'number') numericStats[k] = v;
      }

      results.push({
        externalPlayerId: playerId,
        season,
        week,
        seasonType,
        fantasyPointsStandard: Math.round(ptsStd * 100) / 100,
        fantasyPointsHalfPpr:  Math.round(ptsHalf * 100) / 100,
        fantasyPointsPpr:      Math.round(ptsPpr * 100) / 100,
        rawStats: numericStats,
        gameStatus: null, // Sleeper stats endpoint doesn't include game status per player
      });
    }

    return results;
  },
};
