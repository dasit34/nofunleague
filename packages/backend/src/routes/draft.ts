import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import {
  startDraft,
  getDraftState,
  makePick,
  getAvailablePlayers,
} from '../services/draftService';

const router = Router();
router.use(authenticate);

// Note: Draft start is commissioner-enforced inside startDraft() service
// (checks league.commissioner_id === userId). Middleware can't be used here
// because the route param is :leagueId, not :id as requireCommissioner expects.

// =============================================
// POST /api/draft/:leagueId/start
// Rounds and timer are derived from league settings.
// Commissioner only.
// =============================================
router.post('/:leagueId/start', async (req: AuthRequest, res: Response): Promise<void> => {
  const leagueId = req.params.leagueId as string;
  try {
    const result = await startDraft(leagueId, req.user!.id);
    res.status(201).json(result);
  } catch (err) {
    const e = err as Error & { status?: number };
    res.status(e.status ?? 500).json({ error: e.message });
  }
});

// =============================================
// GET /api/draft/:leagueId/state
// =============================================
router.get('/:leagueId/state', async (req: AuthRequest, res: Response): Promise<void> => {
  const leagueId = req.params.leagueId as string;
  try {
    const state = await getDraftState(leagueId);
    res.json(state);
  } catch (err) {
    const e = err as Error & { status?: number };
    res.status(e.status ?? 500).json({ error: e.message });
  }
});

// =============================================
// POST /api/draft/:leagueId/pick
// Body: { player_id }
// =============================================
router.post('/:leagueId/pick', async (req: AuthRequest, res: Response): Promise<void> => {
  const leagueId = req.params.leagueId as string;
  const { player_id } = req.body;

  if (!player_id) {
    res.status(400).json({ error: 'player_id is required' });
    return;
  }

  try {
    const result = await makePick(leagueId, req.user!.id, player_id as string);
    // Return the pick + refreshed state
    const state = await getDraftState(leagueId).catch(() => null);
    res.json({ ...result, state });
  } catch (err) {
    const e = err as Error & { status?: number };
    res.status(e.status ?? 500).json({ error: e.message });
  }
});

// =============================================
// GET /api/draft/:leagueId/available
// Query: position?, search?, limit?
// =============================================
router.get('/:leagueId/available', async (req: AuthRequest, res: Response): Promise<void> => {
  const leagueId = req.params.leagueId as string;
  try {
    const players = await getAvailablePlayers(leagueId, {
      position: req.query.position as string | undefined,
      search:   req.query.search   as string | undefined,
      limit:    req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
    });
    res.json(players);
  } catch (err) {
    const e = err as Error & { status?: number };
    res.status(e.status ?? 500).json({ error: e.message });
  }
});

export default router;
