import { query, getClient } from '../config/database';
import type { PoolClient } from 'pg';

// =============================================
// Snake draft helpers
// =============================================

/**
 * Given a 1-indexed overall pick number and number of teams,
 * return the 0-indexed position into the draft_order array.
 * Odd rounds go forward (0,1,2,...), even rounds go backward.
 */
export function snakeIndex(overallPick: number, numTeams: number): number {
  const round      = Math.ceil(overallPick / numTeams);
  const pickInRound = ((overallPick - 1) % numTeams) + 1; // 1-indexed
  return round % 2 === 1
    ? pickInRound - 1              // odd round: left to right
    : numTeams - pickInRound;      // even round: right to left
}

export function roundOf(overallPick: number, numTeams: number): number {
  return Math.ceil(overallPick / numTeams);
}

export function pickInRoundOf(overallPick: number, numTeams: number): number {
  return ((overallPick - 1) % numTeams) + 1;
}

// =============================================
// Start draft
// =============================================

export async function startDraft(
  leagueId: string,
  userId: string,
  opts: { total_rounds?: number; seconds_per_pick?: number } = {}
): Promise<{ session_id: string }> {
  // Only commissioner may start
  const { rows: [league] } = await query(
    'SELECT id, commissioner_id, status FROM leagues WHERE id = $1',
    [leagueId]
  );
  if (!league) throw Object.assign(new Error('League not found'), { status: 404 });
  if (league.commissioner_id !== userId)
    throw Object.assign(new Error('Only the commissioner can start the draft'), { status: 403 });
  if (league.status === 'in_season')
    throw Object.assign(new Error('Draft already completed'), { status: 409 });

  // Get teams in league
  const { rows: teams } = await query(
    'SELECT id FROM teams WHERE league_id = $1 ORDER BY created_at',
    [leagueId]
  );
  if (teams.length < 2) throw Object.assign(new Error('Need at least 2 teams to start a draft'), { status: 400 });

  // Randomize draft order (Fisher-Yates shuffle)
  const draftOrder = teams.map((t: { id: string }) => t.id);
  for (let i = draftOrder.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [draftOrder[i], draftOrder[j]] = [draftOrder[j], draftOrder[i]];
  }
  const totalRounds    = opts.total_rounds    ?? 15;
  const secondsPerPick = opts.seconds_per_pick ?? 90;

  // Upsert: if a pending session exists reuse it; otherwise create
  const { rows: [existing] } = await query(
    `SELECT id FROM draft_sessions WHERE league_id = $1 AND status IN ('pending','active')`,
    [leagueId]
  );

  let sessionId: string;
  if (existing) {
    await query(
      `UPDATE draft_sessions
       SET status='active', draft_order=$2, total_rounds=$3, seconds_per_pick=$4,
           current_pick=1, started_at=NOW(), pick_started_at=NOW(), updated_at=NOW()
       WHERE id=$1`,
      [existing.id, draftOrder, totalRounds, secondsPerPick]
    );
    sessionId = existing.id;
  } else {
    const { rows: [sess] } = await query(
      `INSERT INTO draft_sessions
         (league_id, status, total_rounds, seconds_per_pick, current_pick,
          draft_order, started_at, pick_started_at)
       VALUES ($1,'active',$2,$3,1,$4,NOW(),NOW())
       RETURNING id`,
      [leagueId, totalRounds, secondsPerPick, draftOrder]
    );
    sessionId = sess.id;
  }

  // Set league status = drafting
  await query(`UPDATE leagues SET status='drafting', updated_at=NOW() WHERE id=$1`, [leagueId]);

  return { session_id: sessionId };
}

// =============================================
// Get draft state
// =============================================

export interface DraftStatePayload {
  session: Record<string, unknown>;
  teams: { id: string; name: string; user_id: string; display_name: string | null }[];
  picks: Record<string, unknown>[];
  currentTeamId: string | null;
  round: number;
  pickInRound: number;
  secondsRemaining: number;
}

export async function getDraftState(leagueId: string): Promise<DraftStatePayload> {
  const { rows: [session] } = await query(
    `SELECT * FROM draft_sessions WHERE league_id = $1 AND status IN ('active','paused','complete')
     ORDER BY created_at DESC LIMIT 1`,
    [leagueId]
  );
  if (!session) throw Object.assign(new Error('No active draft session for this league'), { status: 404 });

  const numTeams   = (session.draft_order as string[]).length;
  const totalPicks = (session.total_rounds as number) * numTeams;
  const isDone     = (session.current_pick as number) > totalPicks || session.status === 'complete';

  // Teams
  const { rows: teams } = await query(
    `SELECT t.id, t.name, t.user_id, u.display_name
     FROM teams t LEFT JOIN users u ON u.id = t.user_id
     WHERE t.league_id = $1 ORDER BY t.created_at`,
    [leagueId]
  );

  // Picks (with player info)
  const { rows: picks } = await query(
    `SELECT dp.*, p.full_name AS player_name, p.position, p.nfl_team, t.name AS team_name
     FROM draft_picks dp
     JOIN players p ON p.id = dp.player_id
     JOIN teams   t ON t.id = dp.team_id
     WHERE dp.session_id = $1
     ORDER BY dp.overall_pick`,
    [session.id]
  );

  // Current team on the clock
  let currentTeamId: string | null = null;
  let round      = roundOf(session.current_pick as number, numTeams);
  let pickInRound = pickInRoundOf(session.current_pick as number, numTeams);

  if (!isDone) {
    const idx = snakeIndex(session.current_pick as number, numTeams);
    currentTeamId = (session.draft_order as string[])[idx];
  }

  // Seconds remaining on the clock
  let secondsRemaining = 0;
  if (!isDone && session.pick_started_at) {
    const elapsed = (Date.now() - new Date(session.pick_started_at as string).getTime()) / 1000;
    secondsRemaining = Math.max(0, Math.floor((session.seconds_per_pick as number) - elapsed));
  }

  // Timer expired — trigger auto-pick in background; next poll will reflect it
  if (!isDone && secondsRemaining <= 0) {
    performAutoPick(leagueId).catch((err) =>
      console.error('[Draft] Auto-pick trigger failed:', err)
    );
  }

  return { session, teams, picks, currentTeamId, round, pickInRound, secondsRemaining };
}

// =============================================
// Make a pick
// =============================================

export async function makePick(
  leagueId: string,
  userId: string,
  playerId: string
): Promise<{ pick: Record<string, unknown> }> {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Lock the session row
    const { rows: [session] } = await client.query(
      `SELECT * FROM draft_sessions
       WHERE league_id = $1 AND status = 'active'
       FOR UPDATE`,
      [leagueId]
    );
    if (!session) throw Object.assign(new Error('No active draft session'), { status: 404 });

    const numTeams   = (session.draft_order as string[]).length;
    const totalPicks = (session.total_rounds as number) * numTeams;
    const curPick    = session.current_pick as number;

    if (curPick > totalPicks) {
      await client.query('ROLLBACK');
      throw Object.assign(new Error('Draft is complete'), { status: 409 });
    }

    // Verify it is this user's team's turn
    const idx         = snakeIndex(curPick, numTeams);
    const onClockTeamId = (session.draft_order as string[])[idx];

    const { rows: [team] } = await client.query(
      'SELECT id FROM teams WHERE id=$1 AND user_id=$2',
      [onClockTeamId, userId]
    );
    if (!team) throw Object.assign(new Error('It is not your turn to pick'), { status: 403 });

    // No duplicate players in this draft
    const { rows: [already] } = await client.query(
      'SELECT 1 FROM draft_picks WHERE session_id=$1 AND player_id=$2',
      [session.id, playerId]
    );
    if (already) throw Object.assign(new Error('Player already drafted'), { status: 409 });

    // Player must exist
    const { rows: [player] } = await client.query(
      'SELECT id FROM players WHERE id=$1',
      [playerId]
    );
    if (!player) throw Object.assign(new Error('Player not found'), { status: 404 });

    const round      = roundOf(curPick, numTeams);
    const pickInRound = pickInRoundOf(curPick, numTeams);

    // Insert pick
    const { rows: [pick] } = await client.query(
      `INSERT INTO draft_picks
         (session_id, league_id, team_id, player_id, overall_pick, round, pick_in_round)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [session.id, leagueId, team.id, playerId, curPick, round, pickInRound]
    );

    // Assign to roster
    await client.query(
      `INSERT INTO rosters (team_id, player_id, acquisition_type, acquisition_week, is_starter)
       VALUES ($1,$2,'draft',1,FALSE)
       ON CONFLICT (team_id, player_id) DO NOTHING`,
      [team.id, playerId]
    );

    // Advance draft
    const nextPick = curPick + 1;
    const isDone   = nextPick > totalPicks;

    await client.query(
      `UPDATE draft_sessions
       SET current_pick=$2, pick_started_at=NOW(), updated_at=NOW(),
           status=$3, completed_at=$4
       WHERE id=$1`,
      [
        session.id,
        nextPick,
        isDone ? 'complete' : 'active',
        isDone ? new Date().toISOString() : null,
      ]
    );

    if (isDone) {
      // Transition to in_season, reset week to 1, unlock lineups
      await client.query(
        `UPDATE leagues SET status='in_season', week=1, lineup_locked_week=0, updated_at=NOW() WHERE id=$1`,
        [leagueId]
      );

      // Reset team records for a clean season start
      await client.query(
        `UPDATE teams SET wins=0, losses=0, ties=0, points_for=0, points_against=0, updated_at=NOW()
         WHERE league_id=$1`,
        [leagueId]
      );

      // Auto-generate round-robin schedule
      try {
        await generateScheduleForLeague(client, leagueId);
      } catch (schedErr) {
        console.error('[Draft] Schedule generation failed:', schedErr);
      }

      // Set waiver priority: reverse draft order (last pick gets priority 1)
      const draftOrder = session.draft_order as string[];
      for (let i = 0; i < draftOrder.length; i++) {
        await client.query(
          'UPDATE teams SET waiver_priority = $1, updated_at = NOW() WHERE id = $2',
          [draftOrder.length - i, draftOrder[i]]
        );
      }
    }

    await client.query('COMMIT');
    return { pick };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// =============================================
// Auto-pick (timer expiry)
// =============================================

/**
 * If the current pick's timer has genuinely expired, selects the best
 * available player (by peak PPR score, falling back to alphabetical) and
 * submits it as an auto-pick.  Safe to call concurrently — the FOR UPDATE
 * lock on the session ensures only one caller proceeds.
 */
export async function performAutoPick(leagueId: string): Promise<void> {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Lock the session row so concurrent poll requests don't double-pick
    const { rows: [session] } = await client.query(
      `SELECT * FROM draft_sessions WHERE league_id = $1 AND status = 'active' FOR UPDATE`,
      [leagueId]
    );
    if (!session) { await client.query('ROLLBACK'); return; }

    // Re-verify the timer has actually expired (another request may have just picked)
    const elapsed = (Date.now() - new Date(session.pick_started_at as string).getTime()) / 1000;
    if (elapsed < (session.seconds_per_pick as number)) { await client.query('ROLLBACK'); return; }

    const numTeams   = (session.draft_order as string[]).length;
    const totalPicks = (session.total_rounds as number) * numTeams;
    const curPick    = session.current_pick as number;
    if (curPick > totalPicks) { await client.query('ROLLBACK'); return; }

    const idx    = snakeIndex(curPick, numTeams);
    const teamId = (session.draft_order as string[])[idx];

    // Best available: highest peak PPR, then alphabetical fallback
    const { rows: [player] } = await client.query(
      `SELECT p.id
       FROM players p
       LEFT JOIN (
         SELECT player_id, MAX(fantasy_pts_ppr) AS best_ppr
         FROM   player_stats
         GROUP  BY player_id
       ) ps ON ps.player_id = p.id
       WHERE p.id NOT IN (SELECT player_id FROM draft_picks WHERE session_id = $1)
         AND p.position IN ('QB','RB','WR','TE','K','DEF')
       ORDER BY COALESCE(ps.best_ppr, 0) DESC, p.full_name
       LIMIT 1`,
      [session.id]
    );
    if (!player) { await client.query('ROLLBACK'); return; }

    const round       = roundOf(curPick, numTeams);
    const pickInRound = pickInRoundOf(curPick, numTeams);

    // Insert pick — ON CONFLICT DO NOTHING guards against any remaining race
    await client.query(
      `INSERT INTO draft_picks
         (session_id, league_id, team_id, player_id, overall_pick, round, pick_in_round, is_auto_pick)
       VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
       ON CONFLICT DO NOTHING`,
      [session.id, leagueId, teamId, player.id, curPick, round, pickInRound]
    );

    // Add to roster
    await client.query(
      `INSERT INTO rosters (team_id, player_id, acquisition_type, acquisition_week, is_starter)
       SELECT $1, $2, 'draft', 1, FALSE
       WHERE  EXISTS (SELECT 1 FROM players WHERE id = $2)
       ON CONFLICT (team_id, player_id) DO NOTHING`,
      [teamId, player.id]
    );

    const nextPick = curPick + 1;
    const isDone   = nextPick > totalPicks;

    await client.query(
      `UPDATE draft_sessions
       SET current_pick    = $2,
           pick_started_at = NOW(),
           status          = $3,
           completed_at    = $4,
           updated_at      = NOW()
       WHERE id = $1`,
      [session.id, nextPick, isDone ? 'complete' : 'active', isDone ? new Date().toISOString() : null]
    );

    if (isDone) {
      await client.query(
        `UPDATE leagues SET status='in_season', week=1, lineup_locked_week=0, updated_at=NOW() WHERE id=$1`,
        [leagueId]
      );

      // Reset team records
      await client.query(
        `UPDATE teams SET wins=0, losses=0, ties=0, points_for=0, points_against=0, updated_at=NOW()
         WHERE league_id=$1`,
        [leagueId]
      );

      // Auto-generate schedule
      try {
        await generateScheduleForLeague(client, leagueId);
      } catch (schedErr) {
        console.error('[Draft/AutoPick] Schedule generation failed:', schedErr);
      }

      // Set waiver priority
      const draftOrder = session.draft_order as string[];
      for (let i = 0; i < draftOrder.length; i++) {
        await client.query(
          'UPDATE teams SET waiver_priority = $1 WHERE id = $2',
          [draftOrder.length - i, draftOrder[i]]
        );
      }
    }

    await client.query('COMMIT');
    console.log(`[Draft] Auto-pick: team ${teamId} → player ${player.id} (overall pick ${curPick})`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Draft] performAutoPick failed:', err);
  } finally {
    client.release();
  }
}

// =============================================
// Available players
// =============================================

export async function getAvailablePlayers(
  leagueId: string,
  opts: { position?: string; search?: string; limit?: number } = {}
): Promise<Record<string, unknown>[]> {
  const { rows: [session] } = await query(
    `SELECT id FROM draft_sessions WHERE league_id=$1 AND status IN ('active','paused')
     ORDER BY created_at DESC LIMIT 1`,
    [leagueId]
  );
  if (!session) throw Object.assign(new Error('No active draft session'), { status: 404 });

  const params: unknown[] = [session.id];
  const conditions: string[] = [
    `p.id NOT IN (SELECT player_id FROM draft_picks WHERE session_id=$1)`,
    `p.position IN ('QB','RB','WR','TE','K','DEF')`,
  ];

  if (opts.position) {
    params.push(opts.position.toUpperCase());
    conditions.push(`p.position = $${params.length}`);
  }

  if (opts.search) {
    params.push(`%${opts.search}%`);
    conditions.push(`p.full_name ILIKE $${params.length}`);
  }

  const limit = Math.min(opts.limit ?? 50, 200);
  params.push(limit);

  const { rows } = await query(
    `SELECT p.id, p.full_name, p.position, p.nfl_team,
            p.status, p.injury_status, p.age, p.years_exp
     FROM players p
     WHERE ${conditions.join(' AND ')}
     ORDER BY p.position, p.full_name
     LIMIT $${params.length}`,
    params
  );

  return rows;
}

// =============================================
// Auto-generate round-robin schedule after draft
// =============================================

async function generateScheduleForLeague(client: PoolClient, leagueId: string): Promise<void> {
  const { rows: teams } = await client.query(
    'SELECT id FROM teams WHERE league_id = $1 ORDER BY created_at',
    [leagueId]
  );
  if (teams.length < 2) return;

  const ids: string[] = teams.map((t: { id: string }) => t.id);
  const totalWeeks = 13;

  // Standard round-robin (circle method). If odd number of teams, add a bye.
  const hasBye = ids.length % 2 !== 0;
  if (hasBye) ids.push('bye');
  const n = ids.length;

  for (let week = 1; week <= totalWeeks; week++) {
    // Rotate: pin ids[0], rotate rest by (week-1)
    const rotated = [ids[0]];
    for (let i = 1; i < n; i++) {
      rotated.push(ids[1 + ((i - 1 + week - 1) % (n - 1))]);
    }

    for (let i = 0; i < n / 2; i++) {
      const home = rotated[i];
      const away = rotated[n - 1 - i];
      if (home === 'bye' || away === 'bye') continue;

      await client.query(
        `INSERT INTO matchups (league_id, week, home_team_id, away_team_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING`,
        [leagueId, week, home, away]
      );
    }
  }

  console.log(`[Draft] Generated ${totalWeeks}-week schedule for league ${leagueId}`);
}
