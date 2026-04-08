/**
 * Shared roster validation — used by direct add, waiver claims, and waiver processing.
 *
 * Single source of truth for "can this player be added to this team?"
 */

import { query } from '../config/database';
import {
  generateSlotNames,
  totalRosterSize,
  type RosterSettings,
} from '../config/leagueSettings';
import { getSettings } from './settingsService';

export interface ValidationResult {
  valid: boolean;
  error?: string;
  benchSlot?: string;          // The bench slot the player would be assigned to
  rosterSettings?: RosterSettings;
}

/**
 * Validate whether a player can be added to a team's roster.
 * Checks:
 * 1. Player not already rostered in the league
 * 2. Roster capacity not exceeded
 * 3. Position limits not exceeded
 * 4. Bench slot available
 * 5. Waiver lock not active (if checkWaiverLock = true)
 */
export async function validateRosterAdd(
  leagueId: string,
  teamId: string,
  playerId: string,
  opts?: { checkWaiverLock?: boolean },
): Promise<ValidationResult> {
  // Get player info
  const { rows: [player] } = await query(
    'SELECT id, position FROM players WHERE id = $1',
    [playerId]
  );
  if (!player) return { valid: false, error: 'Player not found.' };

  // Check not already rostered in league
  const { rows: [taken] } = await query(
    `SELECT t.name AS team_name FROM rosters r
     JOIN teams t ON t.id = r.team_id
     WHERE r.player_id = $1 AND t.league_id = $2`,
    [playerId, leagueId]
  );
  if (taken) return { valid: false, error: `Player is already rostered by ${taken.team_name}.` };

  // Check waiver lock
  if (opts?.checkWaiverLock) {
    const { rows: [lock] } = await query(
      `SELECT locked_until FROM player_waiver_locks
       WHERE league_id = $1 AND player_id = $2 AND locked_until > NOW()`,
      [leagueId, playerId]
    );
    if (lock) {
      const until = new Date(lock.locked_until).toLocaleString();
      return { valid: false, error: `Player is on waivers until ${until}. Submit a waiver claim instead.` };
    }
  }

  // Get roster settings
  const settings = await getSettings(leagueId);
  const rosterSettings = settings.roster;
  const maxRoster = totalRosterSize(rosterSettings);

  // Check roster capacity
  const { rows: [{ count: currentSize }] } = await query(
    'SELECT COUNT(*)::int AS count FROM rosters WHERE team_id = $1',
    [teamId]
  );
  if ((currentSize as number) >= maxRoster) {
    return { valid: false, error: `Roster is full (${currentSize}/${maxRoster}). Drop a player first.` };
  }

  // Check position limit
  const position = player.position as string;
  const positionLimitMap: Record<string, number> = {
    QB: rosterSettings.max_qb,
    RB: rosterSettings.max_rb,
    WR: rosterSettings.max_wr,
    TE: rosterSettings.max_te,
    K:  rosterSettings.max_k,
    DEF: rosterSettings.max_def,
  };
  const posLimit = positionLimitMap[position] ?? 0;
  if (posLimit > 0) {
    const { rows: [{ count: posCount }] } = await query(
      `SELECT COUNT(*)::int AS count FROM rosters r
       JOIN players p ON p.id = r.player_id
       WHERE r.team_id = $1 AND p.position = $2`,
      [teamId, position]
    );
    if ((posCount as number) >= posLimit) {
      return { valid: false, error: `Position limit reached: ${posCount}/${posLimit} ${position}.` };
    }
  }

  // Find bench slot
  const allSlots = generateSlotNames(rosterSettings);
  const benchSlots = allSlots.filter(s => s.startsWith('BN'));
  const { rows: occupied } = await query(
    `SELECT roster_slot FROM rosters WHERE team_id = $1 AND roster_slot LIKE 'BN%'`,
    [teamId]
  );
  const occupiedSet = new Set(occupied.map((r: { roster_slot: string }) => r.roster_slot));

  let benchSlot: string | null = null;
  for (const slot of benchSlots) {
    if (!occupiedSet.has(slot)) { benchSlot = slot; break; }
  }
  if (!benchSlot) {
    return { valid: false, error: 'No available bench slot. Drop a player first.' };
  }

  return { valid: true, benchSlot, rosterSettings };
}

/**
 * Set a waiver lock on a player in a league.
 * Called when a player is dropped during the season.
 */
export async function setWaiverLock(
  leagueId: string,
  playerId: string,
  droppedByTeamId: string,
  waiverPeriodDays: number,
): Promise<void> {
  if (waiverPeriodDays <= 0) return; // No lock if period is 0

  const lockedUntil = new Date();
  lockedUntil.setDate(lockedUntil.getDate() + waiverPeriodDays);

  await query(
    `INSERT INTO player_waiver_locks (league_id, player_id, locked_until, dropped_by_team_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (league_id, player_id) DO UPDATE SET
       locked_until = EXCLUDED.locked_until,
       dropped_by_team_id = EXCLUDED.dropped_by_team_id`,
    [leagueId, playerId, lockedUntil.toISOString(), droppedByTeamId]
  );
}

/**
 * Check if a player has an active waiver lock in a league.
 */
export async function isWaiverLocked(
  leagueId: string,
  playerId: string,
): Promise<{ locked: boolean; until?: Date }> {
  const { rows: [lock] } = await query(
    `SELECT locked_until FROM player_waiver_locks
     WHERE league_id = $1 AND player_id = $2 AND locked_until > NOW()`,
    [leagueId, playerId]
  );
  if (lock) return { locked: true, until: new Date(lock.locked_until) };
  return { locked: false };
}
