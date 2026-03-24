import cron from 'node-cron';
import { syncPlayersFromSleeper, getNFLState } from './sleeperService';
import { syncPlayerStats } from './statsService';

/**
 * Start all background cron jobs.
 *
 * Schedule (all times UTC):
 *   Every night 02:00  — sync player master data (names, teams, injury status)
 *   Every Tuesday 04:00 — sync game stats for the week that just completed
 *
 * NFL games finish Sunday night / Monday night. Sleeper typically finalises
 * stats by Tuesday morning, making Tuesday 04:00 UTC the safest sync window.
 *
 * Set DISABLE_SCHEDULER=true to skip starting jobs (useful in CI / test envs).
 */
export function startScheduler(): void {
  if (process.env.DISABLE_SCHEDULER === 'true') {
    console.log('[scheduler] Disabled via DISABLE_SCHEDULER env var — skipping');
    return;
  }

  // ── Player master sync — nightly at 02:00 UTC ──────────────────────────
  cron.schedule('0 2 * * *', async () => {
    console.log('[scheduler] Starting nightly player master sync...');
    try {
      await syncPlayersFromSleeper();
      console.log('[scheduler] Player master sync complete');
    } catch (err) {
      console.error('[scheduler] Player master sync failed:', err);
    }
  }, { timezone: 'UTC' });

  // ── Weekly stats sync — every Tuesday at 04:00 UTC ────────────────────
  cron.schedule('0 4 * * 2', async () => {
    console.log('[scheduler] Starting weekly player stats sync...');
    try {
      const state = await getNFLState();
      // Sync the week that just completed (current week - 1).
      // During week 1, week-1 = 0 which Sleeper won't have; Math.max guards this.
      const completedWeek = Math.max(1, state.week - 1);
      const season = parseInt(state.season, 10);
      const seasonType = state.season_type || 'regular';

      console.log(`[scheduler] Syncing stats for ${seasonType} ${season} week ${completedWeek}`);
      const result = await syncPlayerStats(season, completedWeek, seasonType);
      console.log('[scheduler] Stats sync result:', result);
    } catch (err) {
      console.error('[scheduler] Weekly stats sync failed:', err);
    }
  }, { timezone: 'UTC' });

  console.log('[scheduler] Jobs registered: player master sync (daily 02:00 UTC), stats sync (Tue 04:00 UTC)');
}
