import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { query } from '../config/database';
import { runPlayerMasterSync, runPlayerStatsSync, runLeagueRostersSync } from '../services/scheduler';

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
    job:  z.enum(['players', 'stats', 'leagues', 'all']),
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

    res.json({ message: 'Sync complete', results });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Sync failed';
    res.status(500).json({ error: msg, partial_results: results });
  }
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

export default router;
