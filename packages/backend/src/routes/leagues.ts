import { Router, Response } from 'express';
import { z } from 'zod';
import { query } from '../config/database';
import { authenticate, AuthRequest } from '../middleware/auth';
import {
  getSleeperLeague,
  getSleeperRosters,
  getSleeperUsers,
  getSleeperMatchups,
} from '../services/sleeperService';

const router = Router();

// GET /api/leagues — list all leagues for current user
router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  const { rows } = await query(
    `SELECT l.*, t.name as team_name
     FROM leagues l
     LEFT JOIN teams t ON t.league_id = l.id AND t.user_id = $1
     ORDER BY l.created_at DESC`,
    [req.user!.id]
  );
  res.json(rows);
});

// POST /api/leagues — create league
router.post('/', authenticate, async (req: AuthRequest, res: Response) => {
  const Schema = z.object({
    name: z.string().min(1).max(100),
    sleeper_league_id: z.string().optional(),
    season: z.number().optional(),
    ai_enabled: z.boolean().optional(),
  });

  const body = Schema.parse(req.body);
  const { rows } = await query(
    `INSERT INTO leagues (name, commissioner_id, sleeper_league_id, season, ai_enabled)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [body.name, req.user!.id, body.sleeper_league_id || null, body.season || 2025, body.ai_enabled ?? true]
  );
  res.status(201).json(rows[0]);
});

// GET /api/leagues/:id — league details with teams
router.get('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const { rows: [league] } = await query('SELECT * FROM leagues WHERE id = $1', [req.params.id]);
  if (!league) { res.status(404).json({ error: 'League not found' }); return; }

  const { rows: teams } = await query(
    `SELECT t.*, u.display_name, u.avatar_url, u.trash_talk_style
     FROM teams t
     LEFT JOIN users u ON u.id = t.user_id
     WHERE t.league_id = $1
     ORDER BY t.wins DESC, t.points_for DESC`,
    [req.params.id]
  );

  res.json({ ...league, teams });
});

// POST /api/leagues/:id/sync-sleeper — sync from Sleeper API
router.post('/:id/sync-sleeper', authenticate, async (req: AuthRequest, res: Response) => {
  const { rows: [league] } = await query('SELECT * FROM leagues WHERE id = $1', [req.params.id]);
  if (!league) { res.status(404).json({ error: 'League not found' }); return; }
  if (!league.sleeper_league_id) { res.status(400).json({ error: 'No Sleeper league ID linked' }); return; }

  const [sleeperLeague, rosters, sleeperUsers] = await Promise.all([
    getSleeperLeague(league.sleeper_league_id),
    getSleeperRosters(league.sleeper_league_id),
    getSleeperUsers(league.sleeper_league_id),
  ]);

  const userMap = new Map(sleeperUsers.map(u => [u.user_id, u]));

  // Update league info
  await query(
    `UPDATE leagues SET status = $1, updated_at = NOW() WHERE id = $2`,
    [sleeperLeague.status, league.id]
  );

  // Upsert teams from rosters
  for (const roster of rosters) {
    const sleeperUser = userMap.get(roster.owner_id);
    if (!sleeperUser) continue;

    const winsTotal = roster.settings?.wins || 0;
    const lossesTotal = roster.settings?.losses || 0;
    const tiesTotal = roster.settings?.ties || 0;
    const ptsFor = ((roster.settings?.fpts || 0) + (roster.settings?.fpts_decimal || 0) / 100);
    const ptsAgainst = ((roster.settings?.fpts_against || 0) + (roster.settings?.fpts_against_decimal || 0) / 100);

    await query(
      `INSERT INTO teams (league_id, name, sleeper_roster_id, wins, losses, ties, points_for, points_against)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (league_id, sleeper_roster_id) DO UPDATE SET
         wins = EXCLUDED.wins, losses = EXCLUDED.losses, ties = EXCLUDED.ties,
         points_for = EXCLUDED.points_for, points_against = EXCLUDED.points_against,
         updated_at = NOW()`,
      [league.id, sleeperUser.display_name || sleeperUser.username, roster.roster_id,
       winsTotal, lossesTotal, tiesTotal, ptsFor, ptsAgainst]
    );
  }

  res.json({ message: 'Sync complete', synced_rosters: rosters.length });
});

// GET /api/leagues/:id/matchups/:week
router.get('/:id/matchups/:week', authenticate, async (req: AuthRequest, res: Response) => {
  const week = parseInt(req.params.week);
  const { rows } = await query(
    `SELECT m.*,
       ht.name as home_team_name, at.name as away_team_name,
       hu.display_name as home_owner, au.display_name as away_owner
     FROM matchups m
     JOIN teams ht ON ht.id = m.home_team_id
     JOIN teams at ON at.id = m.away_team_id
     LEFT JOIN users hu ON hu.id = ht.user_id
     LEFT JOIN users au ON au.id = at.user_id
     WHERE m.league_id = $1 AND m.week = $2`,
    [req.params.id, week]
  );
  res.json(rows);
});

// POST /api/leagues/:id/import-matchups/:week — import from Sleeper
router.post('/:id/import-matchups/:week', authenticate, async (req: AuthRequest, res: Response) => {
  const { rows: [league] } = await query('SELECT * FROM leagues WHERE id = $1', [req.params.id]);
  if (!league?.sleeper_league_id) { res.status(400).json({ error: 'No Sleeper league ID linked' }); return; }

  const week = parseInt(req.params.week);
  const sleeperMatchups = await getSleeperMatchups(league.sleeper_league_id, week);

  // Group matchups by matchup_id
  const groups = new Map<number, typeof sleeperMatchups>();
  for (const m of sleeperMatchups) {
    if (!groups.has(m.matchup_id)) groups.set(m.matchup_id, []);
    groups.get(m.matchup_id)!.push(m);
  }

  let created = 0;
  for (const [matchupId, pair] of groups) {
    if (pair.length !== 2) continue;
    const [home, away] = pair;

    const { rows: [homeTeam] } = await query(
      'SELECT id FROM teams WHERE league_id = $1 AND sleeper_roster_id = $2',
      [league.id, home.roster_id]
    );
    const { rows: [awayTeam] } = await query(
      'SELECT id FROM teams WHERE league_id = $1 AND sleeper_roster_id = $2',
      [league.id, away.roster_id]
    );
    if (!homeTeam || !awayTeam) continue;

    await query(
      `INSERT INTO matchups (league_id, week, home_team_id, away_team_id, home_score, away_score, sleeper_matchup_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT DO NOTHING`,
      [league.id, week, homeTeam.id, awayTeam.id, home.points || 0, away.points || 0, matchupId]
    );
    created++;
  }

  res.json({ message: `Imported ${created} matchups for week ${week}` });
});

export default router;
