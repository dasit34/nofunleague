import { Router, Response } from 'express';
import { z } from 'zod';
import { query } from '../config/database';
import { authenticate, AuthRequest } from '../middleware/auth';
import { requireCommissioner } from '../middleware/commissioner';

const router = Router();

// =============================================
// POST /api/leagues/:id/waivers/claim — submit a waiver claim
// =============================================
router.post('/:id/waivers/claim', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const Schema = z.object({ player_id: z.string().min(1) });

  let body: z.infer<typeof Schema>;
  try { body = Schema.parse(req.body); }
  catch { res.status(400).json({ error: 'player_id is required' }); return; }

  const leagueId = req.params.id as string;

  // Find user's team in this league
  const { rows: [team] } = await query(
    `SELECT t.id, t.waiver_priority, l.week FROM teams t
     JOIN leagues l ON l.id = t.league_id
     WHERE t.league_id = $1 AND t.user_id = $2`,
    [leagueId, req.user!.id]
  );
  if (!team) { res.status(403).json({ error: 'You do not have a team in this league' }); return; }

  // Player must exist
  const { rows: [player] } = await query('SELECT id, full_name FROM players WHERE id = $1', [body.player_id]);
  if (!player) { res.status(404).json({ error: 'Player not found' }); return; }

  // Player must not already be rostered in this league
  const { rows: [rostered] } = await query(
    `SELECT t.name FROM rosters r JOIN teams t ON t.id = r.team_id
     WHERE r.player_id = $1 AND t.league_id = $2`,
    [body.player_id, leagueId]
  );
  if (rostered) {
    res.status(409).json({ error: `Player is already rostered by ${rostered.name}` });
    return;
  }

  // Check for duplicate pending claim by this team for this player
  const { rows: [existing] } = await query(
    `SELECT id FROM waiver_claims
     WHERE league_id = $1 AND team_id = $2 AND player_id = $3 AND status = 'pending'`,
    [leagueId, team.id, body.player_id]
  );
  if (existing) {
    res.status(409).json({ error: 'You already have a pending claim for this player' });
    return;
  }

  // Check bench space
  const { rows: benchRows } = await query(
    `SELECT roster_slot FROM rosters WHERE team_id = $1 AND roster_slot LIKE 'BN%'`,
    [team.id]
  );
  if (benchRows.length >= 6) {
    res.status(400).json({ error: 'No available bench slots. Drop a player first.' });
    return;
  }

  const { rows: [claim] } = await query(
    `INSERT INTO waiver_claims (league_id, team_id, player_id, week)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [leagueId, team.id, body.player_id, team.week]
  );

  res.status(201).json({ message: 'Waiver claim submitted', claim });
});

// =============================================
// DELETE /api/leagues/:id/waivers/claim/:claimId — cancel a pending claim
// =============================================
router.delete('/:id/waivers/claim/:claimId', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const { rows: [claim] } = await query(
    `SELECT wc.id, wc.team_id FROM waiver_claims wc
     JOIN teams t ON t.id = wc.team_id
     WHERE wc.id = $1 AND wc.league_id = $2 AND wc.status = 'pending' AND t.user_id = $3`,
    [req.params.claimId, req.params.id, req.user!.id]
  );
  if (!claim) { res.status(404).json({ error: 'Claim not found or not yours' }); return; }

  await query('DELETE FROM waiver_claims WHERE id = $1', [claim.id]);
  res.json({ message: 'Claim cancelled' });
});

// =============================================
// GET /api/leagues/:id/waivers — list claims for this league
// Query: ?status=pending (optional filter)
// =============================================
router.get('/:id/waivers', authenticate, async (req: AuthRequest, res: Response) => {
  const status = req.query.status as string | undefined;
  const params: unknown[] = [req.params.id];
  let statusFilter = '';
  if (status) {
    params.push(status);
    statusFilter = `AND wc.status = $${params.length}`;
  }

  const { rows } = await query(
    `SELECT wc.*, t.name AS team_name, u.display_name AS user_name,
            p.full_name AS player_name, p.position AS player_position, p.nfl_team AS player_nfl_team,
            t.waiver_priority
     FROM waiver_claims wc
     JOIN teams t ON t.id = wc.team_id
     LEFT JOIN users u ON u.id = t.user_id
     JOIN players p ON p.id = wc.player_id
     WHERE wc.league_id = $1 ${statusFilter}
     ORDER BY wc.created_at DESC
     LIMIT 100`,
    params
  );
  res.json(rows);
});

// =============================================
// GET /api/leagues/:id/waivers/my-claims — pending claims for current user's team
// =============================================
router.get('/:id/waivers/my-claims', authenticate, async (req: AuthRequest, res: Response) => {
  const { rows: [team] } = await query(
    'SELECT id FROM teams WHERE league_id = $1 AND user_id = $2',
    [req.params.id, req.user!.id]
  );
  if (!team) { res.json([]); return; }

  const { rows } = await query(
    `SELECT wc.*, p.full_name AS player_name, p.position AS player_position, p.nfl_team AS player_nfl_team
     FROM waiver_claims wc
     JOIN players p ON p.id = wc.player_id
     WHERE wc.team_id = $1 AND wc.status = 'pending'
     ORDER BY wc.created_at ASC`,
    [team.id]
  );
  res.json(rows);
});

// =============================================
// POST /api/leagues/:id/waivers/process — process all pending claims
// Commissioner only. Resolves by waiver_priority (lowest number wins).
// =============================================
router.post('/:id/waivers/process', authenticate, requireCommissioner, async (req: AuthRequest, res: Response) => {
  const leagueId = req.params.id as string;

  const { rows: [league] } = await query('SELECT week FROM leagues WHERE id = $1', [leagueId]);
  if (!league) { res.status(404).json({ error: 'League not found' }); return; }

  // Get all pending claims grouped by player, ordered by team waiver priority (lowest first)
  const { rows: claims } = await query(
    `SELECT wc.id, wc.team_id, wc.player_id, t.waiver_priority, t.name AS team_name,
            p.full_name AS player_name
     FROM waiver_claims wc
     JOIN teams t ON t.id = wc.team_id
     JOIN players p ON p.id = wc.player_id
     WHERE wc.league_id = $1 AND wc.status = 'pending'
     ORDER BY wc.player_id, t.waiver_priority ASC NULLS LAST, wc.created_at ASC`,
    [leagueId]
  );

  if (claims.length === 0) {
    res.json({ message: 'No pending claims to process', approved: 0, rejected: 0 });
    return;
  }

  // Group by player_id
  const byPlayer = new Map<string, typeof claims>();
  for (const c of claims) {
    const list = byPlayer.get(c.player_id) || [];
    list.push(c);
    byPlayer.set(c.player_id, list);
  }

  let approved = 0;
  let rejected = 0;
  const winnersTeamIds: string[] = [];

  for (const [playerId, playerClaims] of byPlayer) {
    // Check if player is already rostered (could have been added between claim and processing)
    const { rows: [rostered] } = await query(
      `SELECT 1 FROM rosters r JOIN teams t ON t.id = r.team_id
       WHERE r.player_id = $1 AND t.league_id = $2`,
      [playerId, leagueId]
    );

    if (rostered) {
      // Reject all claims for this player
      for (const c of playerClaims) {
        await query(
          `UPDATE waiver_claims SET status = 'rejected', processed_at = NOW() WHERE id = $1`,
          [c.id]
        );
        rejected++;
      }
      continue;
    }

    // Winner = first claim (lowest waiver_priority due to ORDER BY)
    const winner = playerClaims[0];

    // Check bench space for winner
    const { rows: benchRows } = await query(
      `SELECT roster_slot FROM rosters WHERE team_id = $1 AND roster_slot LIKE 'BN%'`,
      [winner.team_id]
    );
    const occupiedSlots = new Set(benchRows.map((r: { roster_slot: string }) => r.roster_slot));
    let benchSlot: string | null = null;
    for (let i = 1; i <= 6; i++) {
      if (!occupiedSlots.has(`BN${i}`)) { benchSlot = `BN${i}`; break; }
    }

    if (!benchSlot) {
      // Winner has no space — reject all for this player
      for (const c of playerClaims) {
        await query(
          `UPDATE waiver_claims SET status = 'rejected', processed_at = NOW() WHERE id = $1`,
          [c.id]
        );
        rejected++;
      }
      continue;
    }

    // Approve winner
    await query(
      `UPDATE waiver_claims SET status = 'approved', processed_at = NOW() WHERE id = $1`,
      [winner.id]
    );

    // Add player to roster
    await query(
      `INSERT INTO rosters (team_id, player_id, acquisition_type, acquisition_week, is_starter, roster_slot)
       VALUES ($1, $2, 'waiver', $3, FALSE, $4)
       ON CONFLICT (team_id, player_id) DO NOTHING`,
      [winner.team_id, playerId, league.week, benchSlot]
    );

    // Log transaction
    await query(
      `INSERT INTO roster_transactions (league_id, user_id, team_id, player_id, type, detail)
       SELECT $1, t.user_id, $2, $3, 'add', $4
       FROM teams t WHERE t.id = $2`,
      [leagueId, winner.team_id, playerId, `Waiver claim → ${benchSlot}`]
    );

    winnersTeamIds.push(winner.team_id);
    approved++;

    // Reject remaining claims for this player
    for (let i = 1; i < playerClaims.length; i++) {
      await query(
        `UPDATE waiver_claims SET status = 'rejected', processed_at = NOW() WHERE id = $1`,
        [playerClaims[i].id]
      );
      rejected++;
    }
  }

  // Update waiver priorities: winners move to bottom, others shift up
  if (winnersTeamIds.length > 0) {
    // Get all teams sorted by current priority
    const { rows: allTeams } = await query(
      `SELECT id, waiver_priority FROM teams WHERE league_id = $1 ORDER BY waiver_priority ASC NULLS LAST`,
      [leagueId]
    );

    const winnerSet = new Set(winnersTeamIds);
    const nonWinners = allTeams.filter((t: { id: string }) => !winnerSet.has(t.id));
    const winners = allTeams.filter((t: { id: string }) => winnerSet.has(t.id));
    // New order: non-winners first (keeping relative order), then winners
    const newOrder = [...nonWinners, ...winners];

    for (let i = 0; i < newOrder.length; i++) {
      await query('UPDATE teams SET waiver_priority = $1, updated_at = NOW() WHERE id = $2', [i + 1, newOrder[i].id]);
    }
  }

  res.json({
    message: `Waivers processed: ${approved} approved, ${rejected} rejected`,
    approved,
    rejected,
  });
});

export default router;
