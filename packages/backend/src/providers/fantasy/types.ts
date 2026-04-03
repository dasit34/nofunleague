/**
 * Normalized fantasy data types — decoupled from any specific provider (Sleeper, ESPN, etc.)
 *
 * All provider implementations must map their raw data into these shapes.
 */

export interface NormalizedPlayer {
  externalId: string;
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  position: string;
  nflTeam: string | null;
  status: string | null;
  injuryStatus: string | null;
}

export interface NormalizedWeekStats {
  externalPlayerId: string;
  season: number;
  week: number;
  seasonType: string;
  fantasyPointsStandard: number;
  fantasyPointsHalfPpr: number;
  fantasyPointsPpr: number;
  rawStats: Record<string, number>;
  /** Game status from the provider — future use for per-player lock */
  gameStatus: string | null;
}

export interface NormalizedGameInfo {
  gameId: string;
  season: number;
  week: number;
  homeTeam: string;
  awayTeam: string;
  gameStart: string | null; // ISO timestamp
  status: string | null;    // pre | in_progress | complete
}

/**
 * Fantasy data provider interface.
 * Any external data source (Sleeper, ESPN, Yahoo) should implement this.
 */
export interface FantasyDataProvider {
  name: string;

  /** Fetch and normalize all relevant NFL players */
  fetchPlayers(): Promise<NormalizedPlayer[]>;

  /** Fetch and normalize weekly stats for a given season/week */
  fetchWeekStats(season: number, week: number, seasonType?: string): Promise<NormalizedWeekStats[]>;

  /** Fetch game schedule for a given week (for future per-player lock) */
  fetchGameSchedule?(season: number, week: number, seasonType?: string): Promise<NormalizedGameInfo[]>;
}
