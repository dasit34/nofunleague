import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { query } from '../config/database';
import { authenticate } from '../middleware/auth';
import { syncPlayersFromSleeper, getNFLState } from '../services/sleeperService';
import {
  syncPlayerStats,
  calculateFantasyPoints,
  DEFAULT_SCORING,
  STANDARD_SCORING,
  HALF_PPR_SCORING,
  ScoringSettings,
} from '../services/statsService';

const router = Router();

// ─────────────────────────────────────────────────────────────
// IMPORTANT: specific (non-parameterised) routes FIRST —
// Express matches in registration order; /:id would otherwise
// swallow paths like /nfl/state or /sync-stats/current.
// ─────────────────────────────────────────────────────────────

// GET /api/players — search / filter players
router.get('/', async (req: Request, res: Response) => {
  const { position, team, search, limit = '50', offset = '0' } = req.query;

  let sql = 'SELECT * FROM players WHERE 1=1';
  const params: unknown[] = [];

  if (position) { sql += ` AND position = $${params.length + 1}`;      params.push(position); }
  if (team)     { sql += ` AND nfl_team = $${params.length + 1}`;      params.push(team); }
  if (search)   { sql += ` AND full_name ILIKE $${params.length + 1}`; params.push(`%${search}%`); }

  sql += ` ORDER BY full_name LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(parseInt(limit as string), parseInt(offset as string));

  const { rows } = await query(sql, params);
  res.json(rows);
});

// GET /api/players/nfl/state — current NFL week / season
router.get('/nfl/state', async (_req, res: Response) => {
  const state = await getNFLState();
  res.json(state);
});

// GET /api/players/stats/:season/:week — weekly leaderboard
// Query params: position, scoring (std|half|ppr, default ppr), limit, offset
router.get('/stats/:season/:week', async (req: Request, res: Response) => {
  const seasonParam = Array.isArray(req.params.season) ? req.params.season[0] : req.params.season;
  const weekParam   = Array.isArray(req.params.week)   ? req.params.week[0]   : req.params.week;
  const season = parseInt(seasonParam);
  const week   = parseInt(weekParam);
  if (isNaN(season) || isNaN(week)) {
    res.status(400).json({ error: 'season and week must be integers' });
    return;
  }

  const { position, scoring = 'ppr', limit = '50', offset = '0' } = req.query;
  const scoringCol = scoring === 'std'  ? 'ps.fantasy_pts_std'
                   : scoring === 'half' ? 'ps.fantasy_pts_half'
                   : 'ps.fantasy_pts_ppr';

  let sql = `
    SELECT ps.*, p.full_name, p.position, p.nfl_team
    FROM   player_stats ps
    JOIN   players p ON p.id = ps.player_id
    WHERE  ps.season = $1 AND ps.week = $2`;
  const params: unknown[] = [season, week];

  if (position) { sql += ` AND p.position = $${params.length + 1}`; params.push(position); }

  sql += ` ORDER BY ${scoringCol} DESC`;
  sql += ` LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(parseInt(limit as string), parseInt(offset as string));

  const { rows } = await query(sql, params);
  res.json(rows);
});

// POST /api/players/sync — sync player master data from Sleeper (authenticated)
router.post('/sync', authenticate, async (_req, res: Response) => {
  await syncPlayersFromSleeper();
  const { rows: [{ count }] } = await query('SELECT COUNT(*) FROM players');
  res.json({ message: 'Player sync complete', total: parseInt(count) });
});

// POST /api/players/sync-stats — sync game stats for a specific season/week
// Body: { season: number, week: number, season_type?: 'regular'|'pre'|'post' }
router.post('/sync-stats', authenticate, async (req: Request, res: Response) => {
  const Schema = z.object({
    season:      z.number().int().min(2020).max(2040),
    week:        z.number().int().min(1).max(22),
    season_type: z.enum(['regular', 'pre', 'post']).default('regular'),
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

  const result = await syncPlayerStats(body.season, body.week, body.season_type);
  res.json({ message: 'Stats sync complete', ...result });
});

// POST /api/players/sync-stats/current — sync stats for the most recently completed week
router.post('/sync-stats/current', authenticate, async (_req, res: Response) => {
  const state = await getNFLState();
  const week        = Math.max(1, state.week - 1); // week that just completed
  const season      = parseInt(state.season, 10);
  const seasonType  = state.season_type || 'regular';

  const result = await syncPlayerStats(season, week, seasonType);
  res.json({ message: `Stats synced for week ${week}`, ...result });
});

// POST /api/players/score — calculate fantasy points from a raw stat object
// Useful for previewing custom league scoring without touching the DB.
// Body: { stats: object, scoring?: ScoringSettings, format?: 'std'|'half'|'ppr' }
router.post('/score', async (req: Request, res: Response) => {
  const { stats, scoring, format } = req.body as {
    stats: Record<string, number>;
    scoring?: ScoringSettings;
    format?: string;
  };

  if (!stats || typeof stats !== 'object') {
    res.status(400).json({ error: '`stats` object is required' });
    return;
  }

  const presets: Record<string, ScoringSettings> = {
    std:  STANDARD_SCORING,
    half: HALF_PPR_SCORING,
    ppr:  DEFAULT_SCORING,
  };

  const base: ScoringSettings = (format && presets[format]) ? presets[format] : DEFAULT_SCORING;
  const settings: ScoringSettings = { ...base, ...(scoring || {}) };

  res.json({ fantasy_points: calculateFantasyPoints(stats, settings), settings_used: settings });
});

// ─────────────────────────────────────────────────────────────
// Parameterised routes — AFTER all specific routes
// ─────────────────────────────────────────────────────────────

// GET /api/players/:id
router.get('/:id', async (req: Request, res: Response) => {
  const { rows } = await query('SELECT * FROM players WHERE id = $1', [req.params.id]);
  if (!rows[0]) { res.status(404).json({ error: 'Player not found' }); return; }
  res.json(rows[0]);
});

// GET /api/players/:id/stats — all stored stats for one player
// Query params: season, week, scoring (std|half|ppr)
router.get('/:id/stats', async (req: Request, res: Response) => {
  const { season, week, scoring = 'ppr' } = req.query;

  let sql = 'SELECT * FROM player_stats WHERE player_id = $1';
  const params: unknown[] = [req.params.id];

  if (season) { sql += ` AND season = $${params.length + 1}`; params.push(parseInt(season as string)); }
  if (week)   { sql += ` AND week   = $${params.length + 1}`; params.push(parseInt(week as string)); }

  sql += ' ORDER BY season DESC, week DESC';

  const { rows } = await query(sql, params);

  const scoringCol = scoring === 'std' ? 'fantasy_pts_std'
                   : scoring === 'half' ? 'fantasy_pts_half'
                   : 'fantasy_pts_ppr';

  // Attach a normalised `fantasy_points` field for the requested format
  const formatted = rows.map((r) => ({ ...r, fantasy_points: r[scoringCol] }));
  res.json(formatted);
});

export default router;
