import axios from 'axios';
import { query } from '../config/database';

const SLEEPER_BASE = process.env.SLEEPER_API_BASE_URL || 'https://api.sleeper.app/v1';

const sleeper = axios.create({
  baseURL: SLEEPER_BASE,
  timeout: 10000,
});

// =============================================
// Sleeper API Types
// =============================================
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
export async function syncPlayersFromSleeper(): Promise<void> {
  console.log('Syncing NFL players from Sleeper...');
  const { data } = await sleeper.get<Record<string, SleeperPlayer>>('/players/nfl');

  const players = Object.values(data).filter(
    (p) => p.position && ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].includes(p.position)
  );

  // Batch upsert players
  for (const player of players) {
    await query(
      `INSERT INTO players (
        id, full_name, first_name, last_name, position, nfl_team,
        jersey_number, status, injury_status, age, years_exp, college,
        fantasy_positions, metadata, last_synced_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
      ON CONFLICT (id) DO UPDATE SET
        full_name = EXCLUDED.full_name,
        status = EXCLUDED.status,
        injury_status = EXCLUDED.injury_status,
        nfl_team = EXCLUDED.nfl_team,
        metadata = EXCLUDED.metadata,
        last_synced_at = NOW()`,
      [
        player.player_id,
        player.full_name,
        player.first_name,
        player.last_name,
        player.position,
        player.team,
        player.number,
        player.status,
        player.injury_status,
        player.age,
        player.years_exp,
        player.college,
        player.fantasy_positions || [],
        player.metadata || {},
      ]
    );
  }

  console.log(`Synced ${players.length} players.`);
}

// =============================================
// NFL State
// =============================================
export async function getNFLState(): Promise<{ week: number; season: string; season_type: string }> {
  const { data } = await sleeper.get('/state/nfl');
  return data;
}
