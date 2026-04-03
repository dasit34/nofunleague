import axios from 'axios';
import { query } from '../config/database';

const SLEEPER_BASE = process.env.SLEEPER_API_BASE_URL || 'https://api.sleeper.app/v1';

const sleeper = axios.create({
  baseURL: SLEEPER_BASE,
  timeout: 60000, // 60s — /players/nfl returns a very large payload
});

// =============================================
// Sleeper API Types
// =============================================

/**
 * Raw stat fields returned by Sleeper's weekly stats and projections endpoints.
 * Only the fields relevant to fantasy scoring are listed explicitly;
 * the index signature captures anything else Sleeper sends.
 */
export interface SleeperPlayerStats {
  // Passing
  pass_yd?: number;
  pass_td?: number;
  pass_int?: number;
  pass_att?: number;
  pass_cmp?: number;
  pass_2pt?: number;
  // Rushing
  rush_yd?: number;
  rush_td?: number;
  rush_att?: number;
  rush_2pt?: number;
  // Receiving
  rec?: number;
  rec_yd?: number;
  rec_td?: number;
  rec_tgt?: number;
  rec_2pt?: number;
  // General
  fum_lost?: number;
  fum?: number;
  // Kicking
  fg_0_19?: number;
  fg_20_29?: number;
  fg_30_39?: number;
  fg_40_49?: number;
  fg_50p?: number;
  xpt?: number;
  xpt_miss?: number;
  // Defense / ST
  def_sack?: number;
  def_int?: number;
  def_fum_rec?: number;
  def_td?: number;
  def_st_td?: number;
  def_safe?: number;
  def_blk_kick?: number;
  pts_allow?: number;
  // Pre-calculated by Sleeper (not always present)
  pts_ppr?: number;
  pts_half_ppr?: number;
  pts_std?: number;
  // Catch-all
  [key: string]: number | string | undefined;
}
export interface SleeperUser {
  user_id: string;
  username: string;
  display_name: string;
  avatar: string;
}

export interface SleeperLeague {
  league_id: string;
  name: string;
  season: string;
  status: string;
  settings: Record<string, unknown>;
  roster_positions: string[];
  total_rosters: number;
}

export interface SleeperRoster {
  roster_id: number;
  owner_id: string;
  league_id: string;
  players: string[];
  starters: string[];
  settings: {
    wins: number;
    losses: number;
    ties: number;
    fpts: number;
    fpts_decimal: number;
    fpts_against: number;
    fpts_against_decimal: number;
  };
}

export interface SleeperMatchup {
  matchup_id: number;
  roster_id: number;
  starters: string[];
  players: string[];
  points: number;
  starters_points: number[];
  players_points: Record<string, number>;
}

export interface SleeperPlayer {
  player_id: string;
  full_name: string;
  first_name: string;
  last_name: string;
  position: string;
  team: string;
  number: number;
  status: string;
  injury_status: string;
  age: number;
  years_exp: number;
  college: string;
  fantasy_positions: string[];
  metadata: Record<string, unknown>;
}

// =============================================
// User & League Lookups
// =============================================
export async function getSleeperUser(username: string): Promise<SleeperUser> {
  const { data } = await sleeper.get(`/user/${username}`);
  return data;
}

export async function getSleeperLeaguesForUser(userId: string, season: number): Promise<SleeperLeague[]> {
  const { data } = await sleeper.get(`/user/${userId}/leagues/nfl/${season}`);
  return data;
}

export async function getSleeperLeague(leagueId: string): Promise<SleeperLeague> {
  const { data } = await sleeper.get(`/league/${leagueId}`);
  return data;
}

export async function getSleeperRosters(leagueId: string): Promise<SleeperRoster[]> {
  const { data } = await sleeper.get(`/league/${leagueId}/rosters`);
  return data;
}

export async function getSleeperUsers(leagueId: string): Promise<SleeperUser[]> {
  const { data } = await sleeper.get(`/league/${leagueId}/users`);
  return data;
}

export async function getSleeperMatchups(leagueId: string, week: number): Promise<SleeperMatchup[]> {
  const { data } = await sleeper.get(`/league/${leagueId}/matchups/${week}`);
  return data;
}

// =============================================
// Player Cache Sync
// =============================================
export async function syncPlayersFromSleeper(): Promise<number> {
  console.log('[Sleeper] Fetching NFL players...');
  const { data } = await sleeper.get<Record<string, SleeperPlayer>>('/players/nfl');

  const VALID_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);
  const players = Object.values(data).filter(
    (p) => p.player_id && p.position && VALID_POSITIONS.has(p.position)
  );

  console.log(`[Sleeper] Upserting ${players.length} players (row-by-row)...`);

  let upserted = 0;
  for (const p of players) {
    try {
      const name = p.full_name
        || `${p.first_name || ''} ${p.last_name || ''}`.trim()
        || p.player_id;

      await query(
        `INSERT INTO players (
          id, full_name, first_name, last_name, position, nfl_team,
          jersey_number, status, injury_status, age, years_exp, college,
          fantasy_positions, metadata, last_synced_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
        ON CONFLICT (id) DO UPDATE SET
          full_name = EXCLUDED.full_name,
          first_name = COALESCE(EXCLUDED.first_name, players.first_name),
          last_name = COALESCE(EXCLUDED.last_name, players.last_name),
          status = EXCLUDED.status,
          injury_status = EXCLUDED.injury_status,
          nfl_team = EXCLUDED.nfl_team,
          jersey_number = COALESCE(EXCLUDED.jersey_number, players.jersey_number),
          age = COALESCE(EXCLUDED.age, players.age),
          years_exp = COALESCE(EXCLUDED.years_exp, players.years_exp),
          metadata = EXCLUDED.metadata,
          last_synced_at = NOW()`,
        [
          String(p.player_id),
          name,
          p.first_name || null,
          p.last_name || null,
          p.position,
          p.team || null,
          typeof p.number === 'number' ? p.number : null,
          p.status || null,
          p.injury_status || null,
          typeof p.age === 'number' ? p.age : null,
          typeof p.years_exp === 'number' ? p.years_exp : null,
          p.college || null,
          Array.isArray(p.fantasy_positions) ? p.fantasy_positions : [p.position],
          JSON.stringify(p.metadata && typeof p.metadata === 'object' ? p.metadata : {}),
        ]
      );
      upserted++;
    } catch (err) {
      // Skip individual player failures (bad data from Sleeper) — don't abort the whole sync
      if (upserted < 5) {
        console.warn(`[Sleeper] Skip player ${p.player_id}: ${(err as Error).message}`);
      }
    }
  }

  console.log(`[Sleeper] Synced ${upserted}/${players.length} players.`);
  return upserted;
}

// =============================================
// NFL State
// =============================================
export async function getNFLState(): Promise<{ week: number; season: string; season_type: string }> {
  const { data } = await sleeper.get('/state/nfl');
  return data;
}

// =============================================
// NFL Schedule (game start times for lineup lock)
// =============================================

/**
 * Fetch and cache the NFL game schedule for a specific week.
 * Returns the number of games stored.
 *
 * Sleeper schedule endpoint:
 *   GET /schedule/nfl/{season_type}/{season}/{week}
 *
 * Each game object has:
 *   { game_id, home, away, status, start_time (ms epoch) }
 *
 * Gracefully skips games with no usable start_time.
 */
export async function syncNFLSchedule(
  season: number,
  week: number,
  seasonType = 'regular'
): Promise<number> {
  const { data } = await sleeper.get<Record<string, unknown>[]>(
    `/schedule/nfl/${seasonType}/${season}/${week}`
  );

  if (!Array.isArray(data) || data.length === 0) return 0;

  let stored = 0;
  for (const game of data) {
    const home = game.home as string | undefined;
    const away = game.away as string | undefined;
    const rawTime = game.start_time as number | undefined;
    const status = (game.status as string | undefined) || 'pre_game';

    if (!home || !away || !rawTime) continue;

    // Sleeper uses ms epoch; guard against seconds
    const ms = rawTime > 1e12 ? rawTime : rawTime * 1000;
    const gameStart = new Date(ms).toISOString();

    await query(
      `INSERT INTO nfl_games (season, week, season_type, home_team, away_team, game_start, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (season, week, season_type, home_team, away_team) DO UPDATE SET
         game_start = EXCLUDED.game_start,
         status     = EXCLUDED.status,
         synced_at  = NOW()`,
      [season, week, seasonType, home.toUpperCase(), away.toUpperCase(), gameStart, status]
    );
    stored++;
  }

  console.log(`[sleeperService] Synced ${stored} games for ${seasonType} ${season} week ${week}`);
  return stored;
}

// =============================================
// Weekly Stats & Projections
// =============================================

/**
 * Fetch all player game stats for a given week from Sleeper.
 * Returns a map of player_id → stats object.
 * API: GET /stats/nfl/{season_type}/{season}/{week}
 */
export async function getSleeperStats(
  season: number,
  week: number,
  seasonType = 'regular'
): Promise<Record<string, SleeperPlayerStats>> {
  const { data } = await sleeper.get<Record<string, SleeperPlayerStats>>(
    `/stats/nfl/${seasonType}/${season}/${week}`
  );
  return data || {};
}

/**
 * Fetch projected stats for a given week from Sleeper.
 * Returns a map of player_id → projection object.
 * API: GET /projections/nfl/{season_type}/{season}/{week}
 */
export async function getSleeperProjections(
  season: number,
  week: number,
  seasonType = 'regular'
): Promise<Record<string, SleeperPlayerStats>> {
  const { data } = await sleeper.get<Record<string, SleeperPlayerStats>>(
    `/projections/nfl/${seasonType}/${season}/${week}`
  );
  return data || {};
}
