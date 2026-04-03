import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { query } from '../config/database';
import { authenticate, AuthRequest } from '../middleware/auth';
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
// Optional: league_id — if provided, each row gains on_team_id + on_team_name
// showing which team in that league owns the player (null = free agent).
router.get('/', async (req: Request, res: Response) => {
  const { position, team, search, league_id, limit = '50', offset = '0' } = req.query;

  const params: unknown[] = [];
  const where: string[] = ['1=1'];

  if (position) { params.push(position);         where.push(`p.position = $${params.length}`); }
  if (team)     { params.push(team);             where.push(`p.nfl_team = $${params.length}`); }
  if (search)   { params.push(`%${search}%`);   where.push(`p.full_name ILIKE $${params.length}`); }

  let sql: string;
  if (league_id) {
    params.push(league_id);
    const lgParam = params.length;
    // Subquery scopes the roster join to this league only — prevents duplicate
    // rows when a player appears in multiple leagues' rosters.
    sql = `
      SELECT p.*,
             rt.team_id AS on_team_id,
             rt.name    AS on_team_name
      FROM   players p
      LEFT JOIN (
        SELECT r.player_id, r.team_id, t.name
        FROM   rosters r
        JOIN   teams t ON t.id = r.team_id AND t.league_id = $${lgParam}
      ) rt ON rt.player_id = p.id
      WHERE  ${where.join(' AND ')}
      ORDER BY p.full_name
      LIMIT  $${params.length + 1} OFFSET $${params.length + 2}`;
  } else {
    sql = `SELECT * FROM players p WHERE ${where.join(' AND ')}
           ORDER BY p.full_name
           LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  }

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
// The sync can take 2-4 minutes for a remote DB, so we fire-and-forget unless ?wait=true.
router.post('/sync', authenticate, async (req: AuthRequest, res: Response) => {
  const wait = req.query.wait === 'true';

  if (wait) {
    // Blocking mode: wait for sync to complete (may time out on slow connections)
    try {
      const synced = await syncPlayersFromSleeper();
      const { rows: [{ count }] } = await query('SELECT COUNT(*) FROM players');
      res.json({ message: 'Player sync complete', synced, total: parseInt(count) });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sync failed';
      console.error('[players/sync] Error:', msg);
      res.status(502).json({ error: `Sleeper sync failed: ${msg}` });
    }
  } else {
    // Fire-and-forget: respond immediately, sync in background
    res.json({ message: 'Player sync started in background. Check /api/players?limit=1 to verify.' });
    syncPlayersFromSleeper().catch((err) => {
      console.error('[players/sync] Background sync failed:', (err as Error).message);
    });
  }
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
// GET /api/players/debug/week/:week — debug endpoint showing stats + computed fantasy points
// Query: ?season=2024&scoring=ppr&limit=20
// ─────────────────────────────────────────────────────────────
router.get('/debug/week/:week', async (req: Request, res: Response) => {
  const week = parseInt(req.params.week as string);
  const season = parseInt((req.query.season as string) || '2024');
  const scoring = (req.query.scoring as string) || 'ppr';
  const limit = parseInt((req.query.limit as string) || '20');

  if (isNaN(week)) { res.status(400).json({ error: 'week must be an integer' }); return; }

  const col = scoring === 'std' ? 'fantasy_pts_std' : scoring === 'half' ? 'fantasy_pts_half' : 'fantasy_pts_ppr';

  const { rows: [statsInfo] } = await query(
    `SELECT COUNT(*)::int AS total_players,
            MIN(last_synced_at) AS earliest_sync,
            MAX(last_synced_at) AS latest_sync
     FROM player_stats WHERE season = $1 AND week = $2 AND season_type = 'regular'`,
    [season, week]
  );

  const { rows: topPlayers } = await query(
    `SELECT ps.player_id, p.full_name, p.position, p.nfl_team,
            ps.fantasy_pts_std, ps.fantasy_pts_half, ps.fantasy_pts_ppr,
            ps.stats,
            ps.last_synced_at
     FROM player_stats ps
     JOIN players p ON p.id = ps.player_id
     WHERE ps.season = $1 AND ps.week = $2 AND ps.season_type = 'regular'
     ORDER BY ps.${col} DESC NULLS LAST
     LIMIT $3`,
    [season, week, limit]
  );

  // Extract key stat fields for readability
  const players = topPlayers.map((r) => {
    const s = r.stats as Record<string, number> || {};
    return {
      player_id: r.player_id,
      name: r.full_name,
      position: r.position,
      nfl_team: r.nfl_team,
      fantasy_pts: { std: parseFloat(r.fantasy_pts_std), half: parseFloat(r.fantasy_pts_half), ppr: parseFloat(r.fantasy_pts_ppr) },
      key_stats: {
        pass_yd: s.pass_yd || 0, pass_td: s.pass_td || 0, pass_int: s.pass_int || 0,
        rush_yd: s.rush_yd || 0, rush_td: s.rush_td || 0,
        rec: s.rec || 0, rec_yd: s.rec_yd || 0, rec_td: s.rec_td || 0,
        fum_lost: s.fum_lost || 0,
      },
      synced_at: r.last_synced_at,
    };
  });

  res.json({
    season,
    week,
    scoring_format: scoring,
    stats_loaded: (statsInfo.total_players as number) > 0,
    total_player_stats: statsInfo.total_players,
    sync_window: { earliest: statsInfo.earliest_sync, latest: statsInfo.latest_sync },
    top_players: players,
  });
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
