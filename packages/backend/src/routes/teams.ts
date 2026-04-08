import { Router, Response } from 'express';
import { z } from 'zod';
import { query } from '../config/database';
import { authenticate, AuthRequest } from '../middleware/auth';
import {
  generateSlotNames,
  allowedPositionsForSlot,
  isStarterSlot,
  totalRosterSize,
  type RosterSettings,
} from '../config/leagueSettings';
import { getSettings } from '../services/settingsService';
import { validateRosterAdd, setWaiverLock } from '../services/rosterValidation';

const router = Router();

// =============================================
// Helper: get roster settings for a league
// =============================================
async function getLeagueRosterSettings(leagueId: string): Promise<RosterSettings> {
  const settings = await getSettings(leagueId);
  return settings.roster;
}

// =============================================
// Helper: log a roster transaction
// =============================================
async function logTransaction(
  leagueId: string, userId: string, teamId: string,
  playerId: string, type: 'add' | 'drop' | 'move', detail?: string
) {
  await query(
    `INSERT INTO roster_transactions (league_id, user_id, team_id, player_id, type, detail)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [leagueId, userId, teamId, playerId, type, detail || null]
  );
}

// =============================================
// Helper: return full roster for a team, ordered by league slot config
// =============================================
async function getFullRoster(teamId: string, leagueId: string) {
  const rosterSettings = await getLeagueRosterSettings(leagueId);
  const slotOrder = generateSlotNames(rosterSettings);
  // Build a map: slot name → sort index
  const slotIndex = new Map<string, number>();
  slotOrder.forEach((slot, i) => slotIndex.set(slot, i));

  const { rows } = await query(
    `SELECT p.id, p.full_name, p.position, p.nfl_team, p.status, p.injury_status, p.jersey_number,
            p.age, p.years_exp,
            r.is_starter, r.roster_slot, r.acquisition_type, r.acquisition_week
     FROM rosters r JOIN players p ON p.id = r.player_id
     WHERE r.team_id = $1
     ORDER BY p.full_name`,
    [teamId]
  );

  // Sort by slot position in the league's configuration, unassigned last
  rows.sort((a: { roster_slot: string | null }, b: { roster_slot: string | null }) => {
    const ai = a.roster_slot ? (slotIndex.get(a.roster_slot) ?? 999) : 998;
    const bi = b.roster_slot ? (slotIndex.get(b.roster_slot) ?? 999) : 998;
    return ai - bi;
  });

  return rows;
}

// =============================================
// Helper: check if lineup is locked for a team's league
// Returns { locked: boolean, week: number, leagueId: string } or throws
// =============================================
async function checkLineupLock(teamId: string): Promise<{ locked: boolean; week: number; leagueId: string; lineupLockedWeek: number }> {
  const { rows: [row] } = await query(
    `SELECT l.id AS league_id, l.week, l.lineup_locked_week, l.status
     FROM teams t JOIN leagues l ON l.id = t.league_id
     WHERE t.id = $1`,
    [teamId]
  );
  if (!row) throw Object.assign(new Error('Team not found'), { status: 404 });
  const locked = (row.lineup_locked_week as number) >= (row.week as number);
  return { locked, week: row.week, leagueId: row.league_id, lineupLockedWeek: row.lineup_locked_week };
}

// =============================================
// POST /api/teams — create a team
// =============================================
router.post('/', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const Schema = z.object({
    league_id: z.string().uuid(),
    name: z.string().min(1).max(100),
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

  const { rows: [league] } = await query('SELECT id, status FROM leagues WHERE id = $1', [body.league_id]);
  if (!league) { res.status(404).json({ error: 'League not found' }); return; }

  const { rows: [existing] } = await query(
    'SELECT id FROM teams WHERE league_id = $1 AND user_id = $2',
    [body.league_id, req.user!.id]
  );
  if (existing) { res.status(409).json({ error: 'You already have a team in this league' }); return; }

  const { rows: [team] } = await query(
    `INSERT INTO teams (league_id, user_id, name) VALUES ($1, $2, $3) RETURNING *`,
    [body.league_id, req.user!.id, body.name]
  );
  res.status(201).json(team);
});

// =============================================
// GET /api/teams/:id — team details with roster + lock status
// =============================================
router.get('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const { rows: [team] } = await query(
    `SELECT t.*, u.display_name, u.avatar_url, u.trash_talk_style,
            l.week AS league_week, l.lineup_locked_week, l.status AS league_status
     FROM teams t
     LEFT JOIN users u ON u.id = t.user_id
     LEFT JOIN leagues l ON l.id = t.league_id
     WHERE t.id = $1`,
    [req.params.id]
  );
  if (!team) { res.status(404).json({ error: 'Team not found' }); return; }

  const roster = await getFullRoster(req.params.id as string, team.league_id as string);
  const lineup_locked = (team.lineup_locked_week as number) >= (team.league_week as number);

  res.json({ ...team, roster, lineup_locked });
});

// =============================================
// GET /api/teams/:id/scores
// =============================================
router.get('/:id/scores', authenticate, async (req: AuthRequest, res: Response) => {
  const { rows } = await query(
    `SELECT ws.*, p.full_name as highest_scorer_name, b.full_name as biggest_bust_name
     FROM weekly_scores ws
     LEFT JOIN players p ON p.id = ws.highest_scorer_id
     LEFT JOIN players b ON b.id = ws.biggest_bust_id
     WHERE ws.team_id = $1
     ORDER BY ws.week DESC`,
    [req.params.id]
  );
  res.json(rows);
});

// =============================================
// PATCH /api/teams/:id/roster — set starters (bulk)
// =============================================
router.patch('/:id/roster', authenticate, async (req: AuthRequest, res: Response) => {
  const Schema = z.object({ starters: z.array(z.string()).default([]) });
  const body = Schema.parse(req.body);

  const { rows: [team] } = await query(
    `SELECT t.id, l.id AS league_id FROM teams t JOIN leagues l ON l.id = t.league_id
     WHERE t.id = $1 AND t.user_id = $2`,
    [req.params.id as string, req.user!.id]
  );
  if (!team) { res.status(403).json({ error: 'Team not found or you do not own it' }); return; }

  // Lock check
  const lock = await checkLineupLock(team.id);
  if (lock.locked) {
    res.status(423).json({ error: `Lineups are locked for week ${lock.week}. Wait for the week to advance or ask the commissioner to unlock.` });
    return;
  }

  if (body.starters.length > 0) {
    const { rows: found } = await query(
      'SELECT player_id FROM rosters WHERE team_id = $1 AND player_id = ANY($2)',
      [team.id, body.starters]
    );
    if (found.length !== body.starters.length) {
      res.status(400).json({ error: 'One or more players are not on your roster' });
      return;
    }
  }

  await query('UPDATE rosters SET is_starter = false WHERE team_id = $1', [team.id]);
  if (body.starters.length > 0) {
    await query(
      'UPDATE rosters SET is_starter = true WHERE team_id = $1 AND player_id = ANY($2)',
      [team.id, body.starters]
    );
  }

  const roster = await getFullRoster(team.id, team.league_id);
  res.json({ message: 'Roster updated', roster });
});

// =============================================
// GET /api/teams/:id/lineup-lock — lock status for this team
// =============================================
router.get('/:id/lineup-lock', authenticate, async (req: AuthRequest, res: Response) => {
  const { rows: [team] } = await query(
    `SELECT t.id, l.week, l.lineup_locked_week
     FROM teams t JOIN leagues l ON l.id = t.league_id
     WHERE t.id = $1`,
    [req.params.id as string]
  );
  if (!team) { res.status(404).json({ error: 'Team not found' }); return; }

  const locked = (team.lineup_locked_week as number) >= (team.week as number);
  res.json({
    locked,
    week: team.week,
    lineup_locked_week: team.lineup_locked_week,
  });
});

// =============================================
// GET /api/teams/:id/matchup-history
// =============================================
router.get('/:id/matchup-history', authenticate, async (req: AuthRequest, res: Response) => {
  const { rows } = await query(
    `SELECT m.*,
       ht.name as home_name, at.name as away_name,
       CASE WHEN m.home_team_id = $1 THEN m.home_score ELSE m.away_score END as my_score,
       CASE WHEN m.home_team_id = $1 THEN m.away_score ELSE m.home_score END as opp_score,
       CASE WHEN m.winner_team_id = $1 THEN true ELSE false END as won
     FROM matchups m
     JOIN teams ht ON ht.id = m.home_team_id
     JOIN teams at ON at.id = m.away_team_id
     WHERE (m.home_team_id = $1 OR m.away_team_id = $1) AND m.is_complete = TRUE
     ORDER BY m.week DESC`,
    [req.params.id]
  );
  res.json(rows);
});

// =============================================
// PATCH /api/teams/:id/roster/slot — assign player to slot
// Slot validity and position eligibility read from league settings.
// =============================================
router.patch('/:id/roster/slot', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  // Validate player_id is present; slot validated below against league settings
  const BaseSchema = z.object({
    player_id: z.string().min(1),
    slot: z.string().min(1),
  });

  let body: z.infer<typeof BaseSchema>;
  try {
    body = BaseSchema.parse(req.body);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation failed', details: err.errors });
      return;
    }
    throw err;
  }

  const { rows: [team] } = await query(
    'SELECT t.id, t.league_id FROM teams t WHERE t.id = $1 AND t.user_id = $2',
    [req.params.id as string, req.user!.id]
  );
  if (!team) { res.status(403).json({ error: 'Team not found or you do not own it' }); return; }

  // Get league roster settings — source of truth for valid slots
  const rosterSettings = await getLeagueRosterSettings(team.league_id);
  const validSlots = generateSlotNames(rosterSettings);

  // Validate slot against league config
  if (!validSlots.includes(body.slot)) {
    res.status(400).json({ error: `Invalid slot: ${body.slot}. Valid slots: ${validSlots.join(', ')}` });
    return;
  }

  // Lock check
  const lock = await checkLineupLock(team.id);
  if (lock.locked) {
    res.status(423).json({ error: `Lineups are locked for week ${lock.week}. Cannot move players.` });
    return;
  }

  const { rows: [rosterEntry] } = await query(
    `SELECT r.id, r.roster_slot, p.position
     FROM rosters r JOIN players p ON p.id = r.player_id
     WHERE r.team_id = $1 AND r.player_id = $2`,
    [team.id, body.player_id]
  );
  if (!rosterEntry) { res.status(404).json({ error: 'Player is not on your roster' }); return; }

  // Position eligibility from league settings
  const allowed = allowedPositionsForSlot(body.slot, rosterSettings.flex_types);
  if (allowed.length > 0 && !allowed.includes(rosterEntry.position)) {
    res.status(400).json({
      error: `Cannot assign ${rosterEntry.position} to ${body.slot}. Allowed: ${allowed.join(', ')}`,
    });
    return;
  }

  const oldSlot = rosterEntry.roster_slot as string | null;

  // Swap if occupied
  const { rows: [occupant] } = await query(
    'SELECT player_id FROM rosters WHERE team_id = $1 AND roster_slot = $2',
    [team.id, body.slot]
  );
  if (occupant && occupant.player_id !== body.player_id) {
    await query(
      'UPDATE rosters SET roster_slot = $1, is_starter = $2 WHERE team_id = $3 AND player_id = $4',
      [oldSlot, oldSlot ? isStarterSlot(oldSlot) : false, team.id, occupant.player_id]
    );
  }

  const starter = isStarterSlot(body.slot);
  await query(
    'UPDATE rosters SET roster_slot = $1, is_starter = $2 WHERE team_id = $3 AND player_id = $4',
    [body.slot, starter, team.id, body.player_id]
  );

  await logTransaction(team.league_id, req.user!.id, team.id, body.player_id, 'move', `${oldSlot || 'unassigned'} → ${body.slot}`);

  const roster = await getFullRoster(team.id, team.league_id);
  res.json({ message: 'Slot updated', roster });
});

// =============================================
// POST /api/teams/:id/add — add free agent
// Enforces roster size cap and position limits from league settings.
// =============================================
router.post('/:id/add', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const { player_id } = req.body as { player_id?: string };
  if (!player_id) { res.status(400).json({ error: 'player_id is required' }); return; }

  const { rows: [team] } = await query(
    `SELECT t.id, t.league_id, l.week FROM teams t
     JOIN leagues l ON l.id = t.league_id
     WHERE t.id = $1 AND t.user_id = $2`,
    [req.params.id as string, req.user!.id]
  );
  if (!team) { res.status(403).json({ error: 'Team not found or you do not own it' }); return; }

  // Lock check
  const lock = await checkLineupLock(team.id);
  if (lock.locked) {
    res.status(423).json({ error: `Lineups are locked for week ${lock.week}. Cannot add players.` });
    return;
  }

  // Shared validation: roster capacity, position limits, waiver lock, bench slot
  const validation = await validateRosterAdd(team.league_id, team.id, player_id, { checkWaiverLock: true });
  if (!validation.valid) {
    res.status(400).json({ error: validation.error });
    return;
  }
  const benchSlot = validation.benchSlot!;

  await query(
    `INSERT INTO rosters (team_id, player_id, acquisition_type, acquisition_week, is_starter, roster_slot)
     VALUES ($1, $2, 'free_agent', $3, FALSE, $4)
     ON CONFLICT (team_id, player_id) DO NOTHING`,
    [team.id, player_id, team.week, benchSlot]
  );

  await logTransaction(team.league_id, req.user!.id, team.id, player_id, 'add', `Added to ${benchSlot}`);

  res.status(201).json({ message: 'Player added to roster', player_id, roster_slot: benchSlot });
});

// =============================================
// GET /api/teams/:id/available — free agents in league
// =============================================
router.get('/:id/available', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const { rows: [team] } = await query(
    'SELECT t.id, t.league_id FROM teams t WHERE t.id = $1',
    [req.params.id as string]
  );
  if (!team) { res.status(404).json({ error: 'Team not found' }); return; }

  const { position, search, limit = '50' } = req.query;
  const params: unknown[] = [team.league_id];
  const where: string[] = [];

  if (position) { params.push(position); where.push(`p.position = $${params.length}`); }
  if (search) { params.push(`%${search}%`); where.push(`p.full_name ILIKE $${params.length}`); }
  params.push(parseInt(limit as string));

  const sql = `
    SELECT p.id, p.full_name, p.position, p.nfl_team, p.status, p.injury_status
    FROM players p
    WHERE p.id NOT IN (
      SELECT r.player_id FROM rosters r JOIN teams t ON t.id = r.team_id WHERE t.league_id = $1
    )
    ${where.length > 0 ? 'AND ' + where.join(' AND ') : ''}
    ORDER BY p.position, p.full_name
    LIMIT $${params.length}`;

  const { rows } = await query(sql, params);
  res.json(rows);
});

// =============================================
// DELETE /api/teams/:id/drop/:playerId — drop player
// =============================================
router.delete('/:id/drop/:playerId', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const { id: teamId, playerId } = req.params as { id: string; playerId: string };

  const { rows: [team] } = await query(
    'SELECT t.id, t.league_id FROM teams t WHERE t.id = $1 AND t.user_id = $2',
    [teamId, req.user!.id]
  );
  if (!team) { res.status(403).json({ error: 'Team not found or you do not own it' }); return; }

  // Lock check
  const lock = await checkLineupLock(team.id);
  if (lock.locked) {
    res.status(423).json({ error: `Lineups are locked for week ${lock.week}. Cannot drop players.` });
    return;
  }

  const { rows: [rosterEntry] } = await query(
    'SELECT roster_slot FROM rosters WHERE team_id = $1 AND player_id = $2',
    [teamId, playerId]
  );
  if (!rosterEntry) { res.status(404).json({ error: 'Player not on your roster' }); return; }

  await query('DELETE FROM rosters WHERE team_id = $1 AND player_id = $2', [teamId, playerId]);

  // Set waiver lock on dropped player (if league is in season and waiver period > 0)
  const { rows: [leagueRow] } = await query('SELECT status FROM leagues WHERE id = $1', [team.league_id]);
  if (leagueRow && (leagueRow.status === 'in_season' || leagueRow.status === 'post_season')) {
    const settings = await getSettings(team.league_id);
    if (settings.waivers.waiver_period_days > 0) {
      await setWaiverLock(team.league_id, playerId, teamId, settings.waivers.waiver_period_days);
    }
  }

  await logTransaction(
    team.league_id, req.user!.id, teamId, playerId, 'drop',
    rosterEntry.roster_slot ? `Dropped from ${rosterEntry.roster_slot}` : 'Dropped'
  );

  res.json({ message: 'Player dropped', player_id: playerId });
});

export default router;
