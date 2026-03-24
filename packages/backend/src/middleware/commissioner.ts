import { Response, NextFunction } from 'express';
import { query } from '../config/database';
import { AuthRequest } from './auth';

/**
 * Middleware that ensures the authenticated user is the league commissioner.
 * Must be used after `authenticate`. Reads league ID from req.params.id.
 */
export async function requireCommissioner(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const leagueId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!leagueId) {
    res.status(400).json({ error: 'League ID required' });
    return;
  }

  try {
    const { rows: [league] } = await query(
      'SELECT commissioner_id FROM leagues WHERE id = $1',
      [leagueId]
    );

    if (!league) {
      res.status(404).json({ error: 'League not found' });
      return;
    }

    if (league.commissioner_id !== req.user!.id) {
      res.status(403).json({ error: 'Commissioner access required' });
      return;
    }

    next();
  } catch (err) {
    next(err);
  }
}
