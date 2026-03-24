import { Router, Request, Response } from 'express';
import { query } from '../config/database';
import { syncPlayersFromSleeper, getNFLState } from '../services/sleeperService';
import { authenticate } from '../middleware/auth';

const router = Router();

// GET /api/players — search/filter players
router.get('/', async (req: Request, res: Response) => {
  const { position, team, search, limit = '50', offset = '0' } = req.query;

  let sql = 'SELECT * FROM players WHERE 1=1';
  const params: unknown[] = [];

  if (position) { sql += ` AND position = $${params.length + 1}`; params.push(position); }
  if (team) { sql += ` AND nfl_team = $${params.length + 1}`; params.push(team); }
  if (search) { sql += ` AND full_name ILIKE $${params.length + 1}`; params.push(`%${search}%`); }

  sql += ` ORDER BY full_name LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(parseInt(limit as string), parseInt(offset as string));

  const { rows } = await query(sql, params);
  res.json(rows);
});

// GET /api/players/:id
router.get('/:id', async (req: Request, res: Response) => {
  const { rows } = await query('SELECT * FROM players WHERE id = $1', [req.params.id]);
  if (!rows[0]) { res.status(404).json({ error: 'Player not found' }); return; }
  res.json(rows[0]);
});

// POST /api/players/sync — admin: sync all players from Sleeper
router.post('/sync', authenticate, async (_req, res: Response) => {
  await syncPlayersFromSleeper();
  const { rows: [{ count }] } = await query('SELECT COUNT(*) FROM players');
  res.json({ message: 'Player sync complete', total: parseInt(count) });
});

// GET /api/players/nfl/state — current NFL week/season
router.get('/nfl/state', async (_req, res: Response) => {
  const state = await getNFLState();
  res.json(state);
});

export default router;
