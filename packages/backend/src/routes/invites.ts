import { Router, Response } from 'express';
import crypto from 'crypto';
import { query } from '../config/database';
import { authenticate, optionalAuth, AuthRequest } from '../middleware/auth';

const router = Router();

// =============================================
// Helpers
// =============================================

function generateCode(): string {
  // 8 uppercase alphanum chars, URL-safe
  return crypto.randomBytes(6).toString('base64url').toUpperCase().slice(0, 8);
}

// =============================================
// POST /api/leagues/:leagueId/invite
// Commissioner generates (or refreshes) an invite code
// =============================================
router.post('/leagues/:leagueId/invite', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const leagueId = req.params.leagueId as string;
  const { max_uses, expires_in_days } = req.body;

  // Commissioner check
  const { rows: [league] } = await query(
    'SELECT id, name, commissioner_id FROM leagues WHERE id = $1',
    [leagueId]
  );
  if (!league) { res.status(404).json({ error: 'League not found' }); return; }
  if (league.commissioner_id !== req.user!.id) {
    res.status(403).json({ error: 'Only the commissioner can manage invites' });
    return;
  }

  // Deactivate any existing active invites for this league
  await query(
    `UPDATE league_invites SET is_active = FALSE WHERE league_id = $1 AND is_active = TRUE`,
    [leagueId]
  );

  const code = generateCode();
  const expiresAt = expires_in_days
    ? new Date(Date.now() + expires_in_days * 86_400_000).toISOString()
    : null;

  const { rows: [invite] } = await query(
    `INSERT INTO league_invites (league_id, code, created_by, max_uses, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [leagueId, code, req.user!.id, max_uses ?? null, expiresAt]
  );

  res.status(201).json(invite);
});

// =============================================
// GET /api/leagues/:leagueId/invite
// Commissioner views current active invite code
// =============================================
router.get('/leagues/:leagueId/invite', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const leagueId = req.params.leagueId as string;

  const { rows: [league] } = await query(
    'SELECT id, commissioner_id FROM leagues WHERE id = $1',
    [leagueId]
  );
  if (!league) { res.status(404).json({ error: 'League not found' }); return; }
  if (league.commissioner_id !== req.user!.id) {
    res.status(403).json({ error: 'Only the commissioner can view invites' });
    return;
  }

  const { rows: [invite] } = await query(
    `SELECT * FROM league_invites
     WHERE league_id = $1 AND is_active = TRUE
     ORDER BY created_at DESC LIMIT 1`,
    [leagueId]
  );

  res.json(invite || null);
});

// =============================================
// GET /api/invites/:code
// Public — preview invite (no auth required)
// =============================================
router.get('/invites/:code', optionalAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const code = (req.params.code as string).toUpperCase();

  const { rows: [invite] } = await query(
    `SELECT li.*, l.name AS league_name, l.season, l.week, l.status AS league_status,
            u.display_name AS commissioner_name,
            (SELECT COUNT(*) FROM teams WHERE league_id = l.id)::int AS team_count,
            COALESCE((l.settings->>'max_teams')::int, 12) AS max_teams
     FROM   league_invites li
     JOIN   leagues l ON l.id = li.league_id
     JOIN   users   u ON u.id = li.created_by
     WHERE  li.code = $1`,
    [code]
  );

  if (!invite) { res.status(404).json({ error: 'Invite not found' }); return; }
  if (!invite.is_active) { res.status(410).json({ error: 'This invite link has been deactivated' }); return; }
  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
    res.status(410).json({ error: 'This invite link has expired' });
    return;
  }
  if (invite.max_uses !== null && invite.uses >= invite.max_uses) {
    res.status(410).json({ error: 'This invite has reached its maximum number of uses' });
    return;
  }

  // Tell the client if the current user is already a member
  let already_member = false;
  if (req.user) {
    const { rows: [existing] } = await query(
      'SELECT id FROM teams WHERE league_id = $1 AND user_id = $2',
      [invite.league_id, req.user.id]
    );
    already_member = !!existing;
  }

  res.json({ ...invite, already_member });
});

// =============================================
// Shared join logic — used by both join endpoints
// Must be called inside an active BEGIN block.
// Validates the invite (with FOR UPDATE lock) and creates the team.
// Returns the created team row or throws on any violation.
// =============================================
async function acceptInvite(code: string, userId: string): Promise<{ invite: any; team: any }> {
  // Lock the invite row for the duration of the transaction
  const { rows: [invite] } = await query(
    `SELECT li.*, l.name AS league_name, l.status AS league_status,
            COALESCE((l.settings->>'max_teams')::int, 12) AS max_teams
     FROM   league_invites li
     JOIN   leagues l ON l.id = li.league_id
     WHERE  li.code = $1
     FOR UPDATE`,
    [code]
  );

  if (!invite) throw Object.assign(new Error('Invite not found'), { status: 404 });
  if (!invite.is_active) throw Object.assign(new Error('This invite has been deactivated'), { status: 410 });
  if (invite.expires_at && new Date(invite.expires_at) < new Date())
    throw Object.assign(new Error('This invite has expired'), { status: 410 });
  if (invite.max_uses !== null && invite.uses >= invite.max_uses)
    throw Object.assign(new Error('This invite has reached its maximum uses'), { status: 410 });

  // Duplicate membership check
  const { rows: [existing] } = await query(
    'SELECT id FROM teams WHERE league_id = $1 AND user_id = $2',
    [invite.league_id, userId]
  );
  if (existing)
    throw Object.assign(new Error('You are already in this league'), { status: 409, league_id: invite.league_id });

  // Capacity check
  const { rows: [{ team_count }] } = await query(
    'SELECT COUNT(*)::int AS team_count FROM teams WHERE league_id = $1',
    [invite.league_id]
  );
  if (team_count >= invite.max_teams)
    throw Object.assign(new Error(`This league is full (${invite.max_teams} teams max)`), { status: 409 });

  const { rows: [user] } = await query(
    'SELECT display_name, username FROM users WHERE id = $1',
    [userId]
  );
  const teamName = `${user.display_name || user.username}'s Team`;

  const { rows: [team] } = await query(
    `INSERT INTO teams (league_id, user_id, name) VALUES ($1, $2, $3) RETURNING *`,
    [invite.league_id, userId, teamName]
  );

  await query('UPDATE league_invites SET uses = uses + 1 WHERE id = $1', [invite.id]);

  return { invite, team };
}

// =============================================
// POST /api/invites/:code/join   (code in URL)
// POST /api/leagues/join          (code in body)
// Authenticated user accepts invite and joins league
// =============================================
async function handleJoin(code: string, userId: string, res: Response): Promise<void> {
  await query('BEGIN');
  try {
    const { invite, team } = await acceptInvite(code, userId);
    await query('COMMIT');
    res.status(201).json({
      message: `Welcome to ${invite.league_name}!`,
      league_id: invite.league_id,
      team,
    });
  } catch (err: any) {
    await query('ROLLBACK');
    const status = err.status || (err.code === '23505' ? 409 : 500);
    const body: Record<string, unknown> = { error: err.message || 'Join failed' };
    if (err.league_id) body.league_id = err.league_id;
    res.status(status).json(body);
  }
}

router.post('/invites/:code/join', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const code = (req.params.code as string).toUpperCase();
  await handleJoin(code, req.user!.id, res);
});

// =============================================
// POST /api/leagues/join
// Body: { code: string }
// =============================================
router.post('/leagues/join', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const code = (req.body.code as string | undefined)?.toUpperCase();
  if (!code) { res.status(400).json({ error: 'code is required' }); return; }
  await handleJoin(code, req.user!.id, res);
});

// =============================================
// GET /api/leagues/:leagueId/invites
// Commissioner — full invite history (all codes, active or not)
// =============================================
router.get('/leagues/:leagueId/invites', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const leagueId = req.params.leagueId as string;

  const { rows: [league] } = await query(
    'SELECT commissioner_id FROM leagues WHERE id = $1',
    [leagueId]
  );
  if (!league) { res.status(404).json({ error: 'League not found' }); return; }
  if (league.commissioner_id !== req.user!.id) {
    res.status(403).json({ error: 'Only the commissioner can view invite history' });
    return;
  }

  const { rows } = await query(
    `SELECT li.*, u.display_name AS created_by_name
     FROM   league_invites li
     JOIN   users u ON u.id = li.created_by
     WHERE  li.league_id = $1
     ORDER BY li.created_at DESC`,
    [leagueId]
  );

  res.json(rows);
});

// =============================================
// DELETE /api/leagues/:leagueId/invite
// Commissioner deactivates the current invite
// =============================================
router.delete('/leagues/:leagueId/invite', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const leagueId = req.params.leagueId as string;

  const { rows: [league] } = await query(
    'SELECT commissioner_id FROM leagues WHERE id = $1',
    [leagueId]
  );
  if (!league) { res.status(404).json({ error: 'League not found' }); return; }
  if (league.commissioner_id !== req.user!.id) {
    res.status(403).json({ error: 'Only the commissioner can manage invites' });
    return;
  }

  await query(
    `UPDATE league_invites SET is_active = FALSE WHERE league_id = $1 AND is_active = TRUE`,
    [leagueId]
  );

  res.json({ message: 'Invite deactivated' });
});

export default router;
