import { Router, Response } from 'express';
import { z } from 'zod';
import { query } from '../config/database';
import { authenticate, optionalAuth, AuthRequest } from '../middleware/auth';

const router = Router();

// GET /api/chat/:leagueId — get league chat
router.get('/:leagueId', optionalAuth, async (req: AuthRequest, res: Response) => {
  const { limit = '50', before } = req.query;

  let sql = `
    SELECT lc.*, u.display_name, u.avatar_url, u.trash_talk_style,
           t.name as target_team_name
    FROM league_chat lc
    LEFT JOIN users u ON u.id = lc.user_id
    LEFT JOIN teams t ON t.id = lc.ai_target_team_id
    WHERE lc.league_id = $1`;
  const params: unknown[] = [req.params.leagueId];

  if (before) {
    sql += ` AND lc.created_at < $${params.length + 1}`;
    params.push(before);
  }

  sql += ` ORDER BY lc.created_at DESC LIMIT $${params.length + 1}`;
  params.push(parseInt(limit as string));

  const { rows } = await query(sql, params);
  res.json(rows.reverse()); // chronological order
});

// POST /api/chat/:leagueId — send a message
router.post('/:leagueId', authenticate, async (req: AuthRequest, res: Response) => {
  const Schema = z.object({
    message: z.string().min(1).max(2000),
    week: z.number().optional(),
  });

  const body = Schema.parse(req.body);

  // Verify user has a team in this league
  const { rows: [team] } = await query(
    'SELECT id FROM teams WHERE league_id = $1 AND user_id = $2',
    [req.params.leagueId, req.user!.id]
  );

  if (!team) {
    res.status(403).json({ error: 'You are not in this league' });
    return;
  }

  const { rows } = await query(
    `INSERT INTO league_chat (league_id, user_id, message, week)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [req.params.leagueId, req.user!.id, body.message, body.week || null]
  );

  res.status(201).json(rows[0]);
});

export default router;
