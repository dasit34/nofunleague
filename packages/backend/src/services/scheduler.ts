import cron from 'node-cron';
import { query } from '../config/database';
import { syncPlayersFromSleeper, getSleeperRosters, getSleeperUsers, getSleeperLeague, getNFLState, syncNFLSchedule } from './sleeperService';
import { syncPlayerStats } from './statsService';

// =============================================
// Sync Logger — persists run history to DB
// =============================================

export type JobName = 'player_master' | 'player_stats' | 'league_rosters';
type Trigger = 'scheduled' | 'manual';

interface SyncLog {
  id: string;
  job_name: JobName;
  trigger: Trigger;
  status: 'running' | 'success' | 'failure';
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  result: unknown;
  error: string | null;
  context: unknown;
}

async function logStart(jobName: JobName, trigger: Trigger, context?: unknown): Promise<string> {
  try {
    const { rows: [row] } = await query(
      `INSERT INTO sync_logs (job_name, trigger, status, context)
       VALUES ($1, $2, 'running', $3)
       RETURNING id`,
      [jobName, trigger, context ? JSON.stringify(context) : null]
    );
    return row.id as string;
  } catch (err) {
    // DB logging failure must never crash the job
    console.error('[scheduler] Failed to write sync_log start:', err);
    return 'no-log';
  }
}

async function logSuccess(logId: string, result: unknown): Promise<void> {
  if (logId === 'no-log') return;
  try {
    await query(
      `UPDATE sync_logs
       SET status = 'success', finished_at = NOW(),
           duration_ms = EXTRACT(EPOCH FROM (NOW() - started_at))::int * 1000,
           result = $2
       WHERE id = $1`,
      [logId, JSON.stringify(result)]
    );
  } catch (err) {
    console.error('[scheduler] Failed to write sync_log success:', err);
  }
}

async function logFailure(logId: string, error: unknown): Promise<void> {
  if (logId === 'no-log') return;
  const msg = error instanceof Error ? error.message : String(error);
  try {
    await query(
      `UPDATE sync_logs
       SET status = 'failure', finished_at = NOW(),
           duration_ms = EXTRACT(EPOCH FROM (NOW() - started_at))::int * 1000,
           error = $2
       WHERE id = $1`,
      [logId, msg]
    );
  } catch (err) {
    console.error('[scheduler] Failed to write sync_log failure:', err);
  }
}

// =============================================
// Job implementations (reusable by manual trigger)
// =============================================

export async function runPlayerMasterSync(trigger: Trigger = 'scheduled'): Promise<unknown> {
  const logId = await logStart('player_master', trigger);
  console.log(`[scheduler] [${trigger}] Starting player master sync...`);
  try {
    await syncPlayersFromSleeper();
    const { rows: [{ count }] } = await query('SELECT COUNT(*)::int AS count FROM players');
    const result = { total_players: count };
    await logSuccess(logId, result);
    console.log(`[scheduler] [${trigger}] Player master sync complete — ${count} players in DB`);
    return result;
  } catch (err) {
    await logFailure(logId, err);
    console.error(`[scheduler] [${trigger}] Player master sync failed:`, err);
    throw err;
  }
}

export async function runPlayerStatsSync(
  trigger: Trigger = 'scheduled',
  overrideWeek?: number
): Promise<unknown> {
  const state = await getNFLState();
  const season     = parseInt(state.season, 10);
  const seasonType = state.season_type || 'regular';
  // Sync the week that just completed; caller may override (e.g. manual backfill)
  const week = overrideWeek ?? Math.max(1, state.week - 1);

  const logId = await logStart('player_stats', trigger, { season, week, season_type: seasonType });
  console.log(`[scheduler] [${trigger}] Starting player stats sync — ${seasonType} ${season} week ${week}...`);
  try {
    const result = await syncPlayerStats(season, week, seasonType);
    await logSuccess(logId, result);
    console.log(`[scheduler] [${trigger}] Player stats sync complete:`, result);
    return result;
  } catch (err) {
    await logFailure(logId, err);
    console.error(`[scheduler] [${trigger}] Player stats sync failed:`, err);
    throw err;
  }
}

export async function runLeagueRostersSync(trigger: Trigger = 'scheduled'): Promise<unknown> {
  // Fetch all active leagues that are linked to Sleeper
  const { rows: leagues } = await query(
    `SELECT id, sleeper_league_id, week
     FROM leagues
     WHERE sleeper_league_id IS NOT NULL
       AND status IN ('pre_draft', 'drafting', 'in_season', 'post_season')`
  );

  if (leagues.length === 0) {
    console.log(`[scheduler] [${trigger}] No active Sleeper leagues to sync`);
    return { synced_leagues: 0 };
  }

  const logId = await logStart('league_rosters', trigger, { league_count: leagues.length });
  console.log(`[scheduler] [${trigger}] Syncing rosters for ${leagues.length} league(s)...`);

  let syncedLeagues = 0;
  let failedLeagues = 0;
  const errors: string[] = [];

  for (const league of leagues) {
    try {
      const [rosters, sleeperUsers] = await Promise.all([
        getSleeperRosters(league.sleeper_league_id),
        getSleeperUsers(league.sleeper_league_id),
      ]);

      const userMap = new Map(sleeperUsers.map((u: any) => [u.user_id, u]));

      for (const roster of rosters) {
        const sleeperUser = userMap.get(roster.owner_id);
        if (!sleeperUser) continue;

        const winsTotal  = roster.settings?.wins   || 0;
        const lossesTotal= roster.settings?.losses || 0;
        const tiesTotal  = roster.settings?.ties   || 0;
        const ptsFor     = (roster.settings?.fpts || 0) + (roster.settings?.fpts_decimal || 0) / 100;
        const ptsAgainst = (roster.settings?.fpts_against || 0) + (roster.settings?.fpts_against_decimal || 0) / 100;

        const { rows: [team] } = await query(
          `INSERT INTO teams (league_id, name, sleeper_roster_id, wins, losses, ties, points_for, points_against)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (league_id, sleeper_roster_id) DO UPDATE SET
             name           = EXCLUDED.name,
             wins           = EXCLUDED.wins,
             losses         = EXCLUDED.losses,
             ties           = EXCLUDED.ties,
             points_for     = EXCLUDED.points_for,
             points_against = EXCLUDED.points_against,
             updated_at     = NOW()
           RETURNING id`,
          [league.id, sleeperUser.display_name || sleeperUser.username, roster.roster_id,
           winsTotal, lossesTotal, tiesTotal, ptsFor, ptsAgainst]
        );

        if (!team) continue;

        // Re-link user account
        await query(
          `UPDATE teams SET user_id = u.id
           FROM users u
           WHERE teams.id = $1 AND u.sleeper_user_id = $2`,
          [team.id, sleeperUser.user_id]
        );

        // Sync roster players
        if (roster.players?.length) {
          await query('DELETE FROM rosters WHERE team_id = $1', [team.id]);
          for (const playerId of roster.players) {
            const isStarter = (roster.starters || []).includes(playerId);
            await query(
              `INSERT INTO rosters (team_id, player_id, is_starter)
               SELECT $1, $2, $3 WHERE EXISTS (SELECT 1 FROM players WHERE id = $2)
               ON CONFLICT (team_id, player_id) DO UPDATE SET is_starter = EXCLUDED.is_starter`,
              [team.id, playerId, isStarter]
            );
          }
        }
      }

      syncedLeagues++;
    } catch (err) {
      failedLeagues++;
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`league ${league.id}: ${msg}`);
      console.error(`[scheduler] [${trigger}] Failed to sync league ${league.id}:`, err);
    }
  }

  const result = { synced_leagues: syncedLeagues, failed_leagues: failedLeagues, errors };

  if (failedLeagues > 0 && syncedLeagues === 0) {
    await logFailure(logId, errors.join('; '));
  } else {
    await logSuccess(logId, result);
  }

  console.log(`[scheduler] [${trigger}] League roster sync complete:`, result);
  return result;
}

// =============================================
// Scheduler bootstrap
// =============================================

/**
 * Environment rules:
 *   production             → runs by default
 *   any other NODE_ENV     → off by default; opt-in with ENABLE_SCHEDULER=true
 *   DISABLE_SCHEDULER=true → always off, regardless of environment
 *
 * Schedule (UTC):
 *   02:00 daily   — player master sync (names, teams, injury status)
 *   04:00 Tuesday — player stats sync (finalised game stats for completed week)
 *   06:00 Tuesday — league roster sync (W-L, standings, roster assignments)
 */
export function startScheduler(): void {
  const isProduction = process.env.NODE_ENV === 'production';
  const forceEnabled = process.env.ENABLE_SCHEDULER === 'true';
  const forceDisabled = process.env.DISABLE_SCHEDULER === 'true';

  if (forceDisabled) {
    console.log('[scheduler] Disabled via DISABLE_SCHEDULER=true — skipping');
    return;
  }

  if (!isProduction && !forceEnabled) {
    console.log('[scheduler] Not started — set ENABLE_SCHEDULER=true to run in non-production envs');
    return;
  }

  // Nightly player master sync — 02:00 UTC every day
  cron.schedule('0 2 * * *', () => {
    runPlayerMasterSync('scheduled').catch(() => { /* already logged */ });
  }, { timezone: 'UTC' });

  // Weekly stats sync — Tuesday 04:00 UTC
  cron.schedule('0 4 * * 2', () => {
    runPlayerStatsSync('scheduled').catch(() => { /* already logged */ });
  }, { timezone: 'UTC' });

  // Weekly league roster sync — Tuesday 06:00 UTC (after stats are in)
  cron.schedule('0 6 * * 2', () => {
    runLeagueRostersSync('scheduled').catch(() => { /* already logged */ });
  }, { timezone: 'UTC' });

  // NFL schedule sync for the upcoming week — Wednesday 08:00 UTC
  // Schedules for the next week are typically published by Wednesday.
  cron.schedule('0 8 * * 3', async () => {
    console.log('[scheduler] [scheduled] Starting NFL schedule sync...');
    try {
      const state = await getNFLState();
      const season = parseInt(state.season, 10);
      const stored = await syncNFLSchedule(season, state.week, state.season_type || 'regular');
      console.log(`[scheduler] [scheduled] NFL schedule sync complete — ${stored} games`);
    } catch (err) {
      console.error('[scheduler] [scheduled] NFL schedule sync failed:', err);
    }
  }, { timezone: 'UTC' });

  console.log(
    '[scheduler] Jobs registered (UTC): ' +
    'player master (daily 02:00), ' +
    'player stats (Tue 04:00), ' +
    'league rosters (Tue 06:00), ' +
    'NFL schedule (Wed 08:00)'
  );
}
