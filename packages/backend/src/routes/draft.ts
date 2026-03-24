import { Router, Response } from 'express';
import { query } from '../config/database';
import { authenticate, AuthRequest } from '../middleware/auth';
import { getPickPosition } from '../services/draftEngine';
import type { DraftSession, DraftState, DraftPickRow, DraftTeam } from '../services/draftEngine';

const router = Router();
router.use(authenticate);

// =============================================
// Helpers
// =============================================

async function getSessionByLeague(leagueId: string): Promise<DraftSession | null> {
  const { rows: [row] } = await query(
    `SELECT * FROM draft_sessions WHERE league_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [leagueId]
  );
  return row ?? null;
}

async function buildState(session: DraftSession): Promise<DraftState> {
  const [teamsResult, picksResult] = await Promise.all([
    query(
      `SELECT t.id, t.name, t.user_id, u.display_name, u.avatar_url
       FROM   teams t
       LEFT JOIN users u ON u.id = t.user_id
       WHERE  t.league_id = $1
       ORDER  BY t.name`,
      [session.league_id]
    ),
    query(
      `SELECT dp.*,
              p.full_name AS player_name, p.position, p.nfl_team,
              t.name      AS team_name
       FROM   draft_picks dp
       JOIN   players p ON p.id = dp.player_id
       JOIN   teams   t ON t.id = dp.team_id
       WHERE  dp.session_id = $1
       ORDER  BY dp.overall_pick ASC`,
      [session.id]
    ),
  ]);

  const teams = teamsResult.rows as DraftTeam[];
  const picks = picksResult.rows as DraftPickRow[];
  const numTeams = session.draft_order.length;
  const totalPicks = session.total_rounds * (numTeams || 1);
  const isDone = session.status === 'complete' || session.current_pick > totalPicks;

  let currentTeamId: string | null = null;
  let round = 1;
  let pickInRound = 1;

  if (!isDone && numTeams > 0) {
    const pos = getPickPosition(session.current_pick, numTeams);
    round         = pos.round;
    pickInRound   = pos.pickInRound;
    currentTeamId = session.draft_order[pos.teamIndex] ?? null;
  }

  // Compute seconds remaining from pick_started_at
  let secondsRemaining = 0;
  if (session.status === 'active' && (session as any).pick_started_at) {
    const elapsed = Math.floor(
      (Date.now() - new Date((session as any).pick_started_at).getTime()) / 1000
    );
    secondsRemaining = Math.max(0, session.seconds_per_pick - elapsed);
  }

  return { session, teams, picks, currentTeamId, secondsRemaining, round, pickInRound };
}

async function autoPickForSession(session: DraftSession): Promise<void> {
  if (session.status !== 'active') return;

  const numTeams = session.draft_order.length;
  if (numTeams === 0) return;

  const { teamIndex } = getPickPosition(session.current_pick, numTeams);
  const teamId = session.draft_order[teamIndex];
  if (!teamId) return;

  // Best available by PPR stats
  const { rows: [player] } = await query(
    `SELECT p.id
     FROM   players p
     LEFT JOIN (
       SELECT player_id, MAX(fantasy_pts_ppr) AS best_ppr
       FROM   player_stats
       GROUP  BY player_id
     ) ps ON ps.player_id = p.id
     WHERE  p.id NOT IN (
       SELECT player_id FROM draft_picks WHERE session_id = $1
     )
     ORDER  BY COALESCE(ps.best_ppr, 0) DESC, p.full_name
     LIMIT  1`,
    [session.id]
  );

  if (!player) return;

  const { round, pickInRound } = getPickPosition(session.current_pick, numTeams);
  const nextPick   = session.current_pick + 1;
  const totalPicks = session.total_rounds * numTeams;
  const isComplete = nextPick > totalPicks;

  await query('BEGIN');
  try {
    await query(
      `INSERT INTO draft_picks
         (session_id, league_id, team_id, player_id, overall_pick, round, pick_in_round, is_auto_pick)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true)
       ON CONFLICT DO NOTHING`,
      [session.id, session.league_id, teamId, player.id, session.current_pick, round, pickInRound]
    );

    await query(
      `INSERT INTO rosters (team_id, player_id, acquisition_type, acquisition_week, is_starter)
       SELECT $1, $2, 'draft', $3, false
       WHERE  EXISTS (SELECT 1 FROM players WHERE id = $2)
       ON CONFLICT (team_id, player_id) DO NOTHING`,
      [teamId, player.id, round]
    );

    await query(
      `UPDATE draft_sessions
       SET current_pick    = $1,
           status          = $2,
           pick_started_at = ${isComplete ? 'NULL' : 'NOW()'},
           ${isComplete ? 'completed_at = NOW(),' : ''}
           updated_at      = NOW()
       WHERE id = $3`,
      [nextPick, isComplete ? 'complete' : 'active', session.id]
    );

    await query('COMMIT');
  } catch (err) {
    await query('ROLLBACK');
    throw err;
  }
}

// =============================================
// POST /:leagueId/start
// Commissioner creates / starts the draft
// =============================================
router.post('/:leagueId/start', async (req: AuthRequest, res: Response): Promise<void> => {
  const leagueId = req.params.leagueId as string;
  const { total_rounds = 15, seconds_per_pick = 90 } = req.body;

  // Must be commissioner
  const { rows: [league] } = await query(
    'SELECT commissioner_id FROM leagues WHERE id = $1',
    [leagueId]
  );
  if (!league) { res.status(404).json({ error: 'League not found' }); return; }
  if (league.commissioner_id !== req.user!.id) {
    res.status(403).json({ error: 'Only the commissioner can start the draft' });
    return;
  }

  // Fetch teams for the league
  const { rows: teams } = await query(
    'SELECT id FROM teams WHERE league_id = $1 ORDER BY name',
    [leagueId]
  );
  if (teams.length < 2) {
    res.status(400).json({ error: 'Need at least 2 teams to start a draft' });
    return;
  }

  // Randomize draft order
  const teamIds = teams.map((t: any) => t.id);
  for (let i = teamIds.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [teamIds[i], teamIds[j]] = [teamIds[j], teamIds[i]];
  }

  // Check for existing session
  const existing = await getSessionByLeague(leagueId);
  if (existing && existing.status === 'active') {
    res.status(409).json({ error: 'A draft is already in progress' });
    return;
  }

  const { rows: [session] } = await query(
    `INSERT INTO draft_sessions
       (league_id, status, total_rounds, seconds_per_pick, current_pick, draft_order,
        started_at, pick_started_at)
     VALUES ($1, 'active', $2, $3, 1, $4, NOW(), NOW())
     RETURNING *`,
    [leagueId, total_rounds, seconds_per_pick, teamIds]
  );

  // Mark league as drafting
  await query(
    `UPDATE leagues SET status = 'drafting', updated_at = NOW() WHERE id = $1`,
    [leagueId]
  );

  const state = await buildState(session as DraftSession);
  res.status(201).json(state);
});

// =============================================
// GET /:leagueId/state
// Poll for current draft state; auto-picks if timer expired
// =============================================
router.get('/:leagueId/state', async (req: AuthRequest, res: Response): Promise<void> => {
  const leagueId = req.params.leagueId as string;

  const session = await getSessionByLeague(leagueId);
  if (!session) {
    res.status(404).json({ error: 'No draft session found for this league' });
    return;
  }

  // Check if timer has expired and auto-pick is needed
  if (
    session.status === 'active' &&
    (session as any).pick_started_at
  ) {
    const elapsed = Math.floor(
      (Date.now() - new Date((session as any).pick_started_at).getTime()) / 1000
    );
    if (elapsed >= session.seconds_per_pick) {
      try {
        await autoPickForSession(session);
        // Re-fetch after auto-pick
        const updated = await getSessionByLeague(leagueId);
        if (updated) {
          const state = await buildState(updated);
          res.json(state);
          return;
        }
      } catch (err) {
        console.error('[Draft] Auto-pick failed:', err);
      }
    }
  }

  const state = await buildState(session);
  res.json(state);
});

// =============================================
// POST /:leagueId/pick
// Current-turn team owner makes a pick
// =============================================
router.post('/:leagueId/pick', async (req: AuthRequest, res: Response): Promise<void> => {
  const leagueId = req.params.leagueId as string;
  const { player_id } = req.body;

  if (!player_id) { res.status(400).json({ error: 'player_id is required' }); return; }

  const session = await getSessionByLeague(leagueId);
  if (!session) { res.status(404).json({ error: 'No draft session found' }); return; }
  if (session.status !== 'active') {
    res.status(400).json({ error: `Draft is not active (status: ${session.status})` });
    return;
  }

  const numTeams = session.draft_order.length;
  const { round, pickInRound, teamIndex } = getPickPosition(session.current_pick, numTeams);
  const currentTeamId = session.draft_order[teamIndex];

  // Verify it's the requester's team
  const { rows: [team] } = await query(
    'SELECT id, user_id FROM teams WHERE id = $1',
    [currentTeamId]
  );
  if (!team || team.user_id !== req.user!.id) {
    res.status(403).json({ error: 'It is not your turn to pick' });
    return;
  }

  // Check player exists and is not already drafted
  const { rows: [player] } = await query(
    'SELECT id FROM players WHERE id = $1',
    [player_id]
  );
  if (!player) { res.status(404).json({ error: 'Player not found' }); return; }

  const { rows: [alreadyPicked] } = await query(
    'SELECT id FROM draft_picks WHERE session_id = $1 AND player_id = $2',
    [session.id, player_id]
  );
  if (alreadyPicked) { res.status(409).json({ error: 'Player already drafted' }); return; }

  const nextPick   = session.current_pick + 1;
  const totalPicks = session.total_rounds * numTeams;
  const isComplete = nextPick > totalPicks;

  await query('BEGIN');
  try {
    const { rows: [pick] } = await query(
      `INSERT INTO draft_picks
         (session_id, league_id, team_id, player_id, overall_pick, round, pick_in_round, is_auto_pick)
       VALUES ($1, $2, $3, $4, $5, $6, $7, false)
       RETURNING *`,
      [session.id, session.league_id, currentTeamId, player_id,
       session.current_pick, round, pickInRound]
    );

    await query(
      `INSERT INTO rosters (team_id, player_id, acquisition_type, acquisition_week, is_starter)
       SELECT $1, $2, 'draft', $3, false
       WHERE  EXISTS (SELECT 1 FROM players WHERE id = $2)
       ON CONFLICT (team_id, player_id) DO NOTHING`,
      [currentTeamId, player_id, round]
    );

    await query(
      `UPDATE draft_sessions
       SET current_pick    = $1,
           status          = $2,
           pick_started_at = ${isComplete ? 'NULL' : 'NOW()'},
           ${isComplete ? 'completed_at = NOW(),' : ''}
           updated_at      = NOW()
       WHERE id = $3`,
      [nextPick, isComplete ? 'complete' : 'active', session.id]
    );

    if (isComplete) {
      await query(
        `UPDATE leagues SET status = 'in_season', updated_at = NOW() WHERE id = $1`,
        [leagueId]
      );
    }

    await query('COMMIT');

    // Return enriched pick + updated state
    const { rows: [enriched] } = await query(
      `SELECT dp.*, p.full_name AS player_name, p.position, p.nfl_team, t.name AS team_name
       FROM draft_picks dp
       JOIN players p ON p.id = dp.player_id
       JOIN teams   t ON t.id = dp.team_id
       WHERE dp.id = $1`,
      [pick.id]
    );

    const updatedSession = await getSessionByLeague(leagueId);
    const state = updatedSession ? await buildState(updatedSession) : null;

    res.json({ pick: enriched, state });
  } catch (err: any) {
    await query('ROLLBACK');
    if (err.code === '23505') {
      res.status(409).json({ error: 'Player already drafted (concurrent pick)' });
    } else {
      throw err;
    }
  }
});

// =============================================
// GET /:leagueId/available
// Available players not yet drafted
// =============================================
router.get('/:leagueId/available', async (req: AuthRequest, res: Response): Promise<void> => {
  const leagueId = req.params.leagueId as string;
  const { position, search, limit = '50' } = req.query as Record<string, string>;

  const session = await getSessionByLeague(leagueId);
  if (!session) {
    res.status(404).json({ error: 'No draft session found' });
    return;
  }

  const conditions: string[] = [
    `p.id NOT IN (SELECT player_id FROM draft_picks WHERE session_id = $1)`
  ];
  const params: any[] = [session.id];

  if (position) {
    params.push(position.toUpperCase());
    conditions.push(`p.position = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    conditions.push(`p.full_name ILIKE $${params.length}`);
  }

  const parsedLimit = Math.min(parseInt(limit, 10) || 50, 200);

  const { rows } = await query(
    `SELECT p.id, p.full_name, p.position, p.nfl_team, p.injury_status, p.status,
            COALESCE(ps.avg_ppr, 0) AS avg_ppr
     FROM   players p
     LEFT JOIN (
       SELECT player_id, ROUND(AVG(fantasy_pts_ppr)::numeric, 1) AS avg_ppr
       FROM   player_stats
       GROUP  BY player_id
     ) ps ON ps.player_id = p.id
     WHERE  ${conditions.join(' AND ')}
     ORDER  BY COALESCE(ps.avg_ppr, 0) DESC, p.full_name
     LIMIT  $${params.length + 1}`,
    [...params, parsedLimit]
  );

  res.json(rows);
});

export default router;
