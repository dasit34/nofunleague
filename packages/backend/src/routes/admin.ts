import { Router, Request, Response } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { query, getClient } from '../config/database';
import { runPlayerMasterSync, runPlayerStatsSync, runLeagueRostersSync } from '../services/scheduler';
import { syncNFLSchedule, getNFLState } from '../services/sleeperService';
import { startDraft, snakeIndex, roundOf, pickInRoundOf } from '../services/draftService';

const router = Router();

// =============================================
// Admin secret guard middleware
// Requires X-Admin-Secret header matching ADMIN_SECRET env var.
// If ADMIN_SECRET is not set, the endpoint is disabled.
// =============================================
function requireAdminSecret(req: Request, res: Response, next: () => void): void {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) {
    res.status(503).json({ error: 'Admin endpoints are not configured on this server' });
    return;
  }
  const provided = req.headers['x-admin-secret'];
  if (provided !== secret) {
    res.status(401).json({ error: 'Invalid or missing X-Admin-Secret header' });
    return;
  }
  next();
}

// =============================================
// POST /api/admin/sync
// Manually trigger a sync job.
// Body: { job: 'players' | 'stats' | 'leagues' | 'all', week?: number }
// =============================================
router.post('/sync', requireAdminSecret, async (req: Request, res: Response): Promise<void> => {
  const Schema = z.object({
    job:  z.enum(['players', 'stats', 'leagues', 'schedule', 'all']),
    week: z.number().int().min(1).max(22).optional(),
  });

  let body: z.infer<typeof Schema>;
  try {
    body = Schema.parse(req.body);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: err.errors });
      return;
    }
    throw err;
  }

  const results: Record<string, unknown> = {};

  try {
    if (body.job === 'players' || body.job === 'all') {
      results.players = await runPlayerMasterSync('manual');
    }
    if (body.job === 'stats' || body.job === 'all') {
      results.stats = await runPlayerStatsSync('manual', body.week);
    }
    if (body.job === 'leagues' || body.job === 'all') {
      results.leagues = await runLeagueRostersSync('manual');
    }
    if (body.job === 'schedule' || body.job === 'all') {
      const state = await getNFLState();
      const season = parseInt(state.season, 10);
      const week   = body.week ?? state.week;
      const stored = await syncNFLSchedule(season, week, state.season_type || 'regular');
      results.schedule = { season, week, games_stored: stored };
    }

    res.json({ message: 'Sync complete', results });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Sync failed';
    res.status(500).json({ error: msg, partial_results: results });
  }
});

// =============================================
// POST /api/admin/reset-dev
// Purges all mock data created by /api/admin/mock-draft
// (users with @mock.invalid emails + cascaded leagues/teams/rosters/picks).
// Leaves real demo users (@demo.com) untouched.
// =============================================
router.post('/reset-dev', requireAdminSecret, async (_req: Request, res: Response): Promise<void> => {
  const { rowCount: usersDeleted } = await query(
    `DELETE FROM users WHERE email LIKE '%@mock.invalid'`
  );

  const { rowCount: leaguesDeleted } = await query(
    `DELETE FROM leagues
     WHERE id NOT IN (SELECT DISTINCT league_id FROM teams WHERE league_id IS NOT NULL)
       AND commissioner_id NOT IN (SELECT id FROM users WHERE email LIKE '%@demo.com')`
  );

  res.json({
    message: 'Dev reset complete',
    mock_users_deleted:     usersDeleted   ?? 0,
    orphaned_leagues_deleted: leaguesDeleted ?? 0,
  });
});

// =============================================
// GET /api/admin/sync/logs
// List recent sync log entries (newest first)
// Query params: limit (default 20), job, status
// =============================================
router.get('/sync/logs', requireAdminSecret, async (req: Request, res: Response): Promise<void> => {
  const { job, status, limit = '20' } = req.query as Record<string, string>;

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (job) {
    params.push(job);
    conditions.push(`job_name = $${params.length}`);
  }
  if (status) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const parsedLimit = Math.min(parseInt(limit, 10) || 20, 100);

  const { rows } = await query(
    `SELECT * FROM sync_logs ${where}
     ORDER BY started_at DESC
     LIMIT $${params.length + 1}`,
    [...params, parsedLimit]
  );

  res.json(rows);
});

// =============================================
// POST /api/admin/mock-draft
// Creates a complete mock league end-to-end:
//   - N users + teams (default 8)
//   - Creates (or reuses) league named "Mock League <timestamp>"
//   - Starts a snake draft with 1s/pick timer
//   - Runs every pick automatically (best available player)
//   - Returns summary with league_id, teams, and pick log
// Body: { teams?: number (2-12), rounds?: number (1-15), league_name?: string, cleanup?: boolean }
// =============================================
router.post('/mock-draft', requireAdminSecret, async (req: Request, res: Response): Promise<void> => {
  const Schema = z.object({
    teams:                z.number().int().min(2).max(12).default(8),
    rounds:               z.number().int().min(1).max(15).default(5),
    league_name:          z.string().optional(),
    cleanup:              z.boolean().default(false),
    commissioner_user_id: z.string().uuid().optional(), // if provided, team 1 belongs to this real user
  });

  let body: z.infer<typeof Schema>;
  try {
    body = Schema.parse(req.body ?? {});
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: err.errors });
      return;
    }
    throw err;
  }

  const { teams: numTeams, rounds: totalRounds, league_name, cleanup, commissioner_user_id } = body;
  const leagueName = league_name ?? `Mock League ${Date.now()}`;
  const tag = `[MockDraft:${leagueName}]`;

  // ------------------------------------------------------------------
  // 1. Create mock users (skip slot 0 if a real user was supplied)
  // ------------------------------------------------------------------
  const passwordHash = await bcrypt.hash('mockpass123', 10);
  const userIds: string[] = [];

  // Validate commissioner_user_id exists if supplied
  if (commissioner_user_id) {
    const { rows: [realUser] } = await query('SELECT id FROM users WHERE id = $1', [commissioner_user_id]);
    if (!realUser) {
      res.status(400).json({ error: 'commissioner_user_id not found' });
      return;
    }
    userIds.push(commissioner_user_id);
  }

  const ts = Date.now();
  const mockSlotsNeeded = commissioner_user_id ? numTeams - 1 : numTeams;
  for (let i = 0; i < mockSlotsNeeded; i++) {
    const suffix = `mock_user${i}_${ts}`;
    const email  = `${suffix}@mock.invalid`;
    const { rows: [u] } = await query(
      `INSERT INTO users (username, email, password_hash, display_name)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [suffix, email, passwordHash, `Mock User ${i + 1}`]
    );
    userIds.push(u.id);
  }
  console.log(`${tag} Prepared ${numTeams} users (${commissioner_user_id ? '1 real + ' : ''}${mockSlotsNeeded} mock)`);

  // ------------------------------------------------------------------
  // 2. Create league (first user = commissioner)
  // ------------------------------------------------------------------
  const { rows: [league] } = await query(
    `INSERT INTO leagues (name, commissioner_id, season, status)
     VALUES ($1, $2, $3, 'pre_draft')
     RETURNING id`,
    [leagueName, userIds[0], new Date().getFullYear()]
  );
  const leagueId: string = league.id;

  // ------------------------------------------------------------------
  // 3. Create teams (membership = having a team row in the league)
  // ------------------------------------------------------------------
  const teamIds: string[] = [];
  for (let i = 0; i < numTeams; i++) {
    const { rows: [team] } = await query(
      `INSERT INTO teams (league_id, user_id, name) VALUES ($1, $2, $3) RETURNING id`,
      [leagueId, userIds[i], `Mock Team ${i + 1}`]
    );
    teamIds.push(team.id);
  }
  console.log(`${tag} Created ${numTeams} teams in league ${leagueId}`);

  // ------------------------------------------------------------------
  // 4. Start draft (1-second timer so auto-pick fires immediately)
  // ------------------------------------------------------------------
  // Rounds and timer are now derived from league settings
  await startDraft(leagueId, userIds[0]);
  console.log(`${tag} Draft started`);

  // ------------------------------------------------------------------
  // 5. Run all picks automatically
  // ------------------------------------------------------------------
  const { rows: [session] } = await query(
    `SELECT * FROM draft_sessions WHERE league_id=$1 AND status='active'`,
    [leagueId]
  );

  const totalPicks = totalRounds * numTeams;
  const pickLog: Array<{ pick: number; round: number; team: string; player: string; position: string }> = [];

  for (let pick = 1; pick <= totalPicks; pick++) {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      // Re-read session (locked) in case pick count changed
      const { rows: [sess] } = await client.query(
        `SELECT * FROM draft_sessions WHERE id=$1 AND status='active' FOR UPDATE`,
        [session.id]
      );
      if (!sess) { await client.query('ROLLBACK'); break; }

      const idx    = snakeIndex(sess.current_pick as number, numTeams);
      const teamId = (sess.draft_order as string[])[idx];
      const round  = roundOf(sess.current_pick as number, numTeams);
      const pir    = pickInRoundOf(sess.current_pick as number, numTeams);

      // Best available player
      const { rows: [player] } = await client.query(
        `SELECT p.id, p.full_name, p.position
         FROM players p
         LEFT JOIN (
           SELECT player_id, MAX(fantasy_pts_ppr) AS best_ppr
           FROM   player_stats GROUP BY player_id
         ) ps ON ps.player_id = p.id
         WHERE p.id NOT IN (SELECT player_id FROM draft_picks WHERE session_id=$1)
           AND p.position IN ('QB','RB','WR','TE','K','DEF')
         ORDER BY COALESCE(ps.best_ppr, 0) DESC, p.full_name
         LIMIT 1`,
        [sess.id]
      );

      if (!player) { await client.query('ROLLBACK'); break; }

      await client.query(
        `INSERT INTO draft_picks
           (session_id, league_id, team_id, player_id, overall_pick, round, pick_in_round, is_auto_pick)
         VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE) ON CONFLICT DO NOTHING`,
        [sess.id, leagueId, teamId, player.id, sess.current_pick, round, pir]
      );

      await client.query(
        `INSERT INTO rosters (team_id, player_id, acquisition_type, acquisition_week, is_starter)
         VALUES ($1,$2,'draft',1,FALSE) ON CONFLICT DO NOTHING`,
        [teamId, player.id]
      );

      const nextPick = (sess.current_pick as number) + 1;
      const isDone   = nextPick > totalPicks;

      await client.query(
        `UPDATE draft_sessions
         SET current_pick=$2, pick_started_at=NOW(), updated_at=NOW(),
             status=$3, completed_at=$4
         WHERE id=$1`,
        [sess.id, nextPick, isDone ? 'complete' : 'active', isDone ? new Date().toISOString() : null]
      );

      if (isDone) {
        await client.query(
          `UPDATE leagues SET status='in_season', updated_at=NOW() WHERE id=$1`,
          [leagueId]
        );
      }

      await client.query('COMMIT');

      const { rows: [teamRow] } = await query('SELECT name FROM teams WHERE id=$1', [teamId]);
      pickLog.push({ pick: sess.current_pick as number, round, team: teamRow?.name ?? teamId, player: player.full_name, position: player.position });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`${tag} Pick ${pick} failed:`, err);
    } finally {
      client.release();
    }
  }

  console.log(`${tag} Draft complete — ${pickLog.length} picks made`);

  // ------------------------------------------------------------------
  // 6. Verify roster assignments and collect counts
  // ------------------------------------------------------------------
  const { rows: rosterCounts } = await query(
    `SELECT t.name AS team_name, COUNT(r.player_id)::int AS player_count
     FROM teams t
     LEFT JOIN rosters r ON r.team_id = t.id
     WHERE t.league_id = $1
     GROUP BY t.id, t.name
     ORDER BY t.name`,
    [leagueId]
  );

  // Which team belongs to the real user (always teamIds[0] when commissioner_user_id provided)
  const myTeamName = commissioner_user_id
    ? (await query('SELECT name FROM teams WHERE id=$1', [teamIds[0]])).rows[0]?.name ?? 'Mock Team 1'
    : null;

  // ------------------------------------------------------------------
  // 7. Optional cleanup: delete everything we just created
  // ------------------------------------------------------------------
  if (cleanup) {
    await query(`DELETE FROM leagues WHERE id=$1`, [leagueId]);
    for (const uid of userIds) {
      if (uid !== commissioner_user_id) { // never delete the real user
        await query(`DELETE FROM users WHERE id=$1`, [uid]);
      }
    }
    console.log(`${tag} Cleaned up mock data`);
  }

  res.json({
    message:      'Mock draft complete',
    league_id:    cleanup ? null : leagueId,
    league_name:  leagueName,
    teams:        numTeams,
    rounds:       totalRounds,
    picks_made:   pickLog.length,
    my_team_name: myTeamName,
    roster_counts: rosterCounts,
    cleaned_up:   cleanup,
    pick_log:     pickLog,
  });
});

export default router;
