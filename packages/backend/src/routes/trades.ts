import { Router, Response } from 'express';
import { z } from 'zod';
import { query, pool } from '../config/database';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

// =============================================
// Helper: Enrich trade rows with items + player/team names
// =============================================
async function enrichTrades(trades: Record<string, unknown>[]) {
  if (!trades.length) return [];

  const ids = trades.map((t) => t.id as string);
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');

  const { rows: items } = await query(
    `SELECT
       ti.id, ti.trade_id, ti.player_id, ti.from_team_id, ti.to_team_id,
       p.full_name  AS player_name,
       p.position,
       p.nfl_team,
       ft.name AS from_team_name,
       tt.name AS to_team_name
     FROM trade_items ti
     JOIN players p  ON p.id  = ti.player_id
     JOIN teams   ft ON ft.id = ti.from_team_id
     JOIN teams   tt ON tt.id = ti.to_team_id
     WHERE ti.trade_id IN (${placeholders})
     ORDER BY ti.from_team_id, p.full_name`,
    ids
  );

  const itemsByTrade: Record<string, unknown[]> = {};
  for (const item of items) {
    const tid = item.trade_id as string;
    if (!itemsByTrade[tid]) itemsByTrade[tid] = [];
    itemsByTrade[tid].push(item);
  }

  return trades.map((t) => ({
    ...t,
    items: itemsByTrade[t.id as string] || [],
  }));
}

// =============================================
// GET /api/trades/history?league_id=xxx
// All trades in a league (any status)
// =============================================
router.get('/history', authenticate, async (req: AuthRequest, res: Response) => {
  const { league_id } = req.query;
  if (!league_id) { res.status(400).json({ error: 'league_id required' }); return; }

  const { rows } = await query(
    `SELECT
       t.*,
       pt.name AS proposing_team_name,
       rt.name AS receiving_team_name,
       pu.display_name AS proposing_owner,
       ru.display_name AS receiving_owner
     FROM trades t
     JOIN teams pt ON pt.id = t.proposing_team_id
     JOIN teams rt ON rt.id = t.receiving_team_id
     LEFT JOIN users pu ON pu.id = pt.user_id
     LEFT JOIN users ru ON ru.id = rt.user_id
     WHERE t.league_id = $1
     ORDER BY t.created_at DESC`,
    [league_id]
  );

  const enriched = await enrichTrades(rows);
  res.json(enriched);
});

// =============================================
// GET /api/trades/inbox?league_id=xxx
// Active trades involving the current user's team
// =============================================
router.get('/inbox', authenticate, async (req: AuthRequest, res: Response) => {
  const { league_id } = req.query;
  if (!league_id) { res.status(400).json({ error: 'league_id required' }); return; }

  const { rows: [myTeam] } = await query(
    'SELECT id FROM teams WHERE league_id = $1 AND user_id = $2',
    [league_id, req.user!.id]
  );
  if (!myTeam) { res.json([]); return; }

  const { rows } = await query(
    `SELECT
       t.*,
       pt.name AS proposing_team_name,
       rt.name AS receiving_team_name,
       pu.display_name AS proposing_owner,
       ru.display_name AS receiving_owner
     FROM trades t
     JOIN teams pt ON pt.id = t.proposing_team_id
     JOIN teams rt ON rt.id = t.receiving_team_id
     LEFT JOIN users pu ON pu.id = pt.user_id
     LEFT JOIN users ru ON ru.id = rt.user_id
     WHERE t.league_id = $1
       AND (t.proposing_team_id = $2 OR t.receiving_team_id = $2)
       AND t.status IN ('pending', 'accepted')
     ORDER BY t.created_at DESC`,
    [league_id, myTeam.id]
  );

  const enriched = await enrichTrades(rows);
  res.json(enriched);
});

// =============================================
// GET /api/trades/pending-approval?league_id=xxx
// Trades awaiting commissioner decision (commissioner only)
// =============================================
router.get('/pending-approval', authenticate, async (req: AuthRequest, res: Response) => {
  const { league_id } = req.query;
  if (!league_id) { res.status(400).json({ error: 'league_id required' }); return; }

  const { rows: [league] } = await query(
    'SELECT commissioner_id FROM leagues WHERE id = $1',
    [league_id]
  );
  if (!league) { res.status(404).json({ error: 'League not found' }); return; }
  if (league.commissioner_id !== req.user!.id) {
    res.status(403).json({ error: 'Commissioner access required' });
    return;
  }

  const { rows } = await query(
    `SELECT
       t.*,
       pt.name AS proposing_team_name,
       rt.name AS receiving_team_name,
       pu.display_name AS proposing_owner,
       ru.display_name AS receiving_owner
     FROM trades t
     JOIN teams pt ON pt.id = t.proposing_team_id
     JOIN teams rt ON rt.id = t.receiving_team_id
     LEFT JOIN users pu ON pu.id = pt.user_id
     LEFT JOIN users ru ON ru.id = rt.user_id
     WHERE t.league_id = $1 AND t.status = 'accepted'
     ORDER BY t.responded_at ASC`,
    [league_id]
  );

  const enriched = await enrichTrades(rows);
  res.json(enriched);
});

// =============================================
// POST /api/trades/propose
// =============================================
router.post('/propose', authenticate, async (req: AuthRequest, res: Response) => {
  const Schema = z.object({
    league_id:            z.string().uuid(),
    proposing_team_id:    z.string().uuid(),
    receiving_team_id:    z.string().uuid(),
    proposing_player_ids: z.array(z.string()).min(1, 'Must include at least one player to give'),
    receiving_player_ids: z.array(z.string()).min(1, 'Must include at least one player to receive'),
    proposer_note:        z.string().max(500).optional(),
  });

  const body = Schema.parse(req.body);

  if (body.proposing_team_id === body.receiving_team_id) {
    res.status(400).json({ error: 'Cannot trade with yourself' });
    return;
  }

  // Verify proposing team belongs to user and is in the specified league
  const { rows: [propTeam] } = await query(
    'SELECT id FROM teams WHERE id = $1 AND user_id = $2 AND league_id = $3',
    [body.proposing_team_id, req.user!.id, body.league_id]
  );
  if (!propTeam) {
    res.status(403).json({ error: 'You do not own the proposing team in this league' });
    return;
  }

  // Verify receiving team is in same league
  const { rows: [recvTeam] } = await query(
    'SELECT id FROM teams WHERE id = $1 AND league_id = $2',
    [body.receiving_team_id, body.league_id]
  );
  if (!recvTeam) {
    res.status(400).json({ error: 'Receiving team not found in this league' });
    return;
  }

  // Verify proposing players are on proposing team's roster
  const { rows: propRoster } = await query(
    'SELECT player_id FROM rosters WHERE player_id = ANY($1) AND team_id = $2',
    [body.proposing_player_ids, body.proposing_team_id]
  );
  if (propRoster.length !== body.proposing_player_ids.length) {
    res.status(400).json({ error: 'Some players you are giving do not belong to your team' });
    return;
  }

  // Verify receiving players are on receiving team's roster
  const { rows: recvRoster } = await query(
    'SELECT player_id FROM rosters WHERE player_id = ANY($1) AND team_id = $2',
    [body.receiving_player_ids, body.receiving_team_id]
  );
  if (recvRoster.length !== body.receiving_player_ids.length) {
    res.status(400).json({ error: 'Some players you are requesting do not belong to the other team' });
    return;
  }

  // Check no player is already in an active trade in this league
  const allPlayerIds = [...body.proposing_player_ids, ...body.receiving_player_ids];
  const { rows: blocked } = await query(
    `SELECT ti.player_id, p.full_name
     FROM trade_items ti
     JOIN trades t ON t.id = ti.trade_id
     JOIN players p ON p.id = ti.player_id
     WHERE t.league_id = $1
       AND t.status IN ('pending', 'accepted')
       AND ti.player_id = ANY($2)`,
    [body.league_id, allPlayerIds]
  );
  if (blocked.length > 0) {
    const names = blocked.map((r: Record<string, unknown>) => r.full_name).join(', ');
    res.status(409).json({ error: `Already in an active trade: ${names}` });
    return;
  }

  // Create the trade
  const { rows: [trade] } = await query(
    `INSERT INTO trades (league_id, proposing_team_id, receiving_team_id, proposer_note)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [body.league_id, body.proposing_team_id, body.receiving_team_id, body.proposer_note || null]
  );

  // Insert trade items
  const itemRows = [
    ...body.proposing_player_ids.map((pid) => [trade.id, pid, body.proposing_team_id, body.receiving_team_id]),
    ...body.receiving_player_ids.map((pid)  => [trade.id, pid, body.receiving_team_id, body.proposing_team_id]),
  ];
  for (const [tradeId, playerId, fromTeam, toTeam] of itemRows) {
    await query(
      'INSERT INTO trade_items (trade_id, player_id, from_team_id, to_team_id) VALUES ($1, $2, $3, $4)',
      [tradeId, playerId, fromTeam, toTeam]
    );
  }

  const [enriched] = await enrichTrades([trade]);
  res.status(201).json(enriched);
});

// =============================================
// POST /api/trades/:id/respond
// Receiving team owner accepts or rejects a pending trade
// =============================================
router.post('/:id/respond', authenticate, async (req: AuthRequest, res: Response) => {
  const Schema = z.object({
    action:        z.enum(['accept', 'reject']),
    response_note: z.string().max(500).optional(),
  });

  const body = Schema.parse(req.body);

  const { rows: [trade] } = await query(
    `SELECT t.*, rt.user_id AS receiving_user_id
     FROM trades t JOIN teams rt ON rt.id = t.receiving_team_id
     WHERE t.id = $1`,
    [req.params.id]
  );
  if (!trade) { res.status(404).json({ error: 'Trade not found' }); return; }
  if (trade.status !== 'pending') {
    res.status(400).json({ error: `Trade is already ${trade.status}` });
    return;
  }
  if (trade.receiving_user_id !== req.user!.id) {
    res.status(403).json({ error: 'Only the receiving team owner can respond to this trade' });
    return;
  }

  const newStatus = body.action === 'accept' ? 'accepted' : 'rejected';
  const { rows: [updated] } = await query(
    `UPDATE trades
     SET status = $1, response_note = $2, responded_at = NOW()
     WHERE id = $3 RETURNING *`,
    [newStatus, body.response_note || null, trade.id]
  );

  const [enriched] = await enrichTrades([updated]);
  res.json(enriched);
});

// =============================================
// POST /api/trades/:id/approve
// Commissioner approves or vetoes an accepted trade;
// approval atomically swaps players between rosters
// =============================================
router.post('/:id/approve', authenticate, async (req: AuthRequest, res: Response) => {
  const Schema = z.object({
    action:             z.enum(['approve', 'veto']),
    commissioner_note:  z.string().max(500).optional(),
  });

  const body = Schema.parse(req.body);

  const { rows: [trade] } = await query('SELECT * FROM trades WHERE id = $1', [req.params.id]);
  if (!trade) { res.status(404).json({ error: 'Trade not found' }); return; }
  if (trade.status !== 'accepted') {
    res.status(400).json({
      error: `Trade must be accepted before commissioner review (current: ${trade.status})`,
    });
    return;
  }

  const { rows: [league] } = await query(
    'SELECT commissioner_id, week FROM leagues WHERE id = $1',
    [trade.league_id]
  );
  if (league.commissioner_id !== req.user!.id) {
    res.status(403).json({ error: 'Commissioner access required' });
    return;
  }

  if (body.action === 'veto') {
    const { rows: [updated] } = await query(
      `UPDATE trades
       SET status = 'vetoed', commissioner_note = $1, decided_at = NOW()
       WHERE id = $2 RETURNING *`,
      [body.commissioner_note || null, trade.id]
    );
    const [enriched] = await enrichTrades([updated]);
    res.json(enriched);
    return;
  }

  // Approve: execute atomic roster swap
  const { rows: items } = await query('SELECT * FROM trade_items WHERE trade_id = $1', [trade.id]);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const item of items) {
      // Remove player from current team
      await client.query(
        'DELETE FROM rosters WHERE team_id = $1 AND player_id = $2',
        [item.from_team_id, item.player_id]
      );
      // Add player to new team — lands on bench, new owner sets their slot
      await client.query(
        `INSERT INTO rosters (team_id, player_id, acquisition_type, acquisition_week, is_starter, roster_slot)
         VALUES ($1, $2, 'trade', $3, false, 'BN')
         ON CONFLICT (team_id, player_id) DO NOTHING`,
        [item.to_team_id, item.player_id, league.week]
      );
    }

    await client.query(
      `UPDATE trades
       SET status = 'approved', commissioner_note = $1, decided_at = NOW()
       WHERE id = $2`,
      [body.commissioner_note || null, trade.id]
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const { rows: [finalTrade] } = await query('SELECT * FROM trades WHERE id = $1', [trade.id]);
  const [enriched] = await enrichTrades([finalTrade]);
  res.json(enriched);
});

export default router;
