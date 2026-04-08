/**
 * Commissioner Correction Tools — Phase 6A
 *
 * Endpoints for commissioners to fix common league issues:
 * - Transfer player between teams
 * - Force add/drop player for a team
 * - Edit matchup score with standings correction
 */

import { Router, Response } from 'express';
import { z } from 'zod';
import { query, getClient } from '../config/database';
import { authenticate, AuthRequest } from '../middleware/auth';
import { requireCommissioner } from '../middleware/commissioner';
import {
  generateSlotNames,
  totalRosterSize,
  type RosterSettings,
} from '../config/leagueSettings';
import { getSettings } from '../services/settingsService';

const router = Router({ mergeParams: true });

// All commissioner endpoints require authentication + commissioner role
router.use(authenticate);
router.use(requireCommissioner);

// =============================================
// Helper: get roster settings for a league
// =============================================
async function getLeagueRosterSettings(leagueId: string): Promise<RosterSettings> {
  const settings = await getSettings(leagueId);
  return settings.roster;
}

// =============================================
// Helper: find first available bench slot
// =============================================
async function findOpenBenchSlot(teamId: string, rosterSettings: RosterSettings): Promise<string | null> {
  const allSlots = generateSlotNames(rosterSettings);
  const benchSlots = allSlots.filter(s => s.startsWith('BN'));

  const { rows: occupied } = await query(
    `SELECT roster_slot FROM rosters WHERE team_id = $1 AND roster_slot LIKE 'BN%'`,
    [teamId]
  );
  const occupiedSet = new Set(occupied.map((r: { roster_slot: string }) => r.roster_slot));

  for (const slot of benchSlots) {
    if (!occupiedSet.has(slot)) return slot;
  }
  return null;
}

// =============================================
// Helper: check position limit
// =============================================
async function checkPositionLimit(
  teamId: string,
  position: string,
  rosterSettings: RosterSettings,
): Promise<{ allowed: boolean; current: number; limit: number }> {
  const limitMap: Record<string, number> = {
    QB: rosterSettings.max_qb,
    RB: rosterSettings.max_rb,
    WR: rosterSettings.max_wr,
    TE: rosterSettings.max_te,
    K:  rosterSettings.max_k,
    DEF: rosterSettings.max_def,
  };
  const limit = limitMap[position] ?? 0;
  if (limit === 0) return { allowed: true, current: 0, limit: 0 }; // no limit

  const { rows: [{ count }] } = await query(
    `SELECT COUNT(*)::int AS count FROM rosters r
     JOIN players p ON p.id = r.player_id
     WHERE r.team_id = $1 AND p.position = $2`,
    [teamId, position]
  );
  return { allowed: (count as number) < limit, current: count as number, limit };
}

// =============================================
// POST /api/leagues/:id/commissioner/transfer
// Move a player from one team to another.
// =============================================
router.post('/transfer', async (req: AuthRequest, res: Response): Promise<void> => {
  const Schema = z.object({
    player_id:    z.string().min(1),
    from_team_id: z.string().uuid(),
    to_team_id:   z.string().uuid(),
  });

  let body: z.infer<typeof Schema>;
  try { body = Schema.parse(req.body); }
  catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ error: 'Validation failed', details: err.errors }); return; }
    throw err;
  }

  if (body.from_team_id === body.to_team_id) {
    res.status(400).json({ error: 'Source and destination teams must be different.' });
    return;
  }

  const leagueId = req.params.id as string;

  // Validate both teams belong to this league
  const { rows: teams } = await query(
    'SELECT id FROM teams WHERE league_id = $1 AND id IN ($2, $3)',
    [leagueId, body.from_team_id, body.to_team_id]
  );
  if (teams.length < 2) {
    res.status(400).json({ error: 'One or both teams do not belong to this league.' });
    return;
  }

  // Verify player is on the source team
  const { rows: [rosterEntry] } = await query(
    'SELECT r.id, r.roster_slot, p.position FROM rosters r JOIN players p ON p.id = r.player_id WHERE r.team_id = $1 AND r.player_id = $2',
    [body.from_team_id, body.player_id]
  );
  if (!rosterEntry) {
    res.status(404).json({ error: 'Player is not on the source team roster.' });
    return;
  }

  // Verify player is NOT already on the destination team
  const { rows: [alreadyOnDest] } = await query(
    'SELECT id FROM rosters WHERE team_id = $1 AND player_id = $2',
    [body.to_team_id, body.player_id]
  );
  if (alreadyOnDest) {
    res.status(409).json({ error: 'Player is already on the destination team.' });
    return;
  }

  // Check destination roster capacity
  const rosterSettings = await getLeagueRosterSettings(leagueId);
  const maxRoster = totalRosterSize(rosterSettings);
  const { rows: [{ count: destSize }] } = await query(
    'SELECT COUNT(*)::int AS count FROM rosters WHERE team_id = $1',
    [body.to_team_id]
  );
  if ((destSize as number) >= maxRoster) {
    res.status(400).json({ error: `Destination team roster is full (${destSize}/${maxRoster}).` });
    return;
  }

  // Check position limit on destination
  const posCheck = await checkPositionLimit(body.to_team_id, rosterEntry.position, rosterSettings);
  if (!posCheck.allowed) {
    res.status(400).json({ error: `Destination team at ${rosterEntry.position} limit (${posCheck.current}/${posCheck.limit}).` });
    return;
  }

  // Find bench slot on destination
  const benchSlot = await findOpenBenchSlot(body.to_team_id, rosterSettings);
  if (!benchSlot) {
    res.status(400).json({ error: 'No available bench slot on destination team.' });
    return;
  }

  // Execute transfer in a transaction
  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Remove from source team
    await client.query(
      'DELETE FROM rosters WHERE team_id = $1 AND player_id = $2',
      [body.from_team_id, body.player_id]
    );

    // Add to destination team bench
    await client.query(
      `INSERT INTO rosters (team_id, player_id, acquisition_type, is_starter, roster_slot)
       VALUES ($1, $2, 'commissioner', FALSE, $3)
       ON CONFLICT (team_id, player_id) DO NOTHING`,
      [body.to_team_id, body.player_id, benchSlot]
    );

    // Log transactions
    await client.query(
      `INSERT INTO roster_transactions (league_id, user_id, team_id, player_id, type, detail)
       VALUES ($1, $2, $3, $4, 'drop', $5)`,
      [leagueId, req.user!.id, body.from_team_id, body.player_id, 'Commissioner transfer out']
    );
    await client.query(
      `INSERT INTO roster_transactions (league_id, user_id, team_id, player_id, type, detail)
       VALUES ($1, $2, $3, $4, 'add', $5)`,
      [leagueId, req.user!.id, body.to_team_id, body.player_id, `Commissioner transfer in → ${benchSlot}`]
    );

    await client.query('COMMIT');
    res.json({ message: 'Player transferred successfully', player_id: body.player_id, from: body.from_team_id, to: body.to_team_id, slot: benchSlot });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// =============================================
// POST /api/leagues/:id/commissioner/roster-action
// Force add or drop a player for a team.
// Bypasses owner check and lineup lock.
// =============================================
router.post('/roster-action', async (req: AuthRequest, res: Response): Promise<void> => {
  const Schema = z.object({
    team_id:   z.string().uuid(),
    action:    z.enum(['add', 'drop']),
    player_id: z.string().min(1),
  });

  let body: z.infer<typeof Schema>;
  try { body = Schema.parse(req.body); }
  catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ error: 'Validation failed', details: err.errors }); return; }
    throw err;
  }

  const leagueId = req.params.id as string;

  // Validate team belongs to league
  const { rows: [team] } = await query(
    'SELECT id FROM teams WHERE id = $1 AND league_id = $2',
    [body.team_id, leagueId]
  );
  if (!team) { res.status(404).json({ error: 'Team not found in this league.' }); return; }

  if (body.action === 'add') {
    // Validate player exists
    const { rows: [player] } = await query(
      'SELECT id, full_name, position FROM players WHERE id = $1',
      [body.player_id]
    );
    if (!player) { res.status(404).json({ error: 'Player not found.' }); return; }

    // Check not already on any team in league
    const { rows: [taken] } = await query(
      `SELECT r.team_id, t.name AS team_name FROM rosters r
       JOIN teams t ON t.id = r.team_id
       WHERE r.player_id = $1 AND t.league_id = $2`,
      [body.player_id, leagueId]
    );
    if (taken) {
      res.status(409).json({ error: `Player is already rostered by ${taken.team_name}.` });
      return;
    }

    // Check roster capacity
    const rosterSettings = await getLeagueRosterSettings(leagueId);
    const maxRoster = totalRosterSize(rosterSettings);
    const { rows: [{ count: currentSize }] } = await query(
      'SELECT COUNT(*)::int AS count FROM rosters WHERE team_id = $1',
      [body.team_id]
    );
    if ((currentSize as number) >= maxRoster) {
      res.status(400).json({ error: `Roster is full (${currentSize}/${maxRoster}).` });
      return;
    }

    // Check position limit
    const posCheck = await checkPositionLimit(body.team_id, player.position, rosterSettings);
    if (!posCheck.allowed) {
      res.status(400).json({ error: `Position limit reached: ${posCheck.current}/${posCheck.limit} ${player.position}.` });
      return;
    }

    // Find bench slot
    const benchSlot = await findOpenBenchSlot(body.team_id, rosterSettings);
    if (!benchSlot) {
      res.status(400).json({ error: 'No available bench slot.' });
      return;
    }

    // Insert
    await query(
      `INSERT INTO rosters (team_id, player_id, acquisition_type, is_starter, roster_slot)
       VALUES ($1, $2, 'commissioner', FALSE, $3)
       ON CONFLICT (team_id, player_id) DO NOTHING`,
      [body.team_id, body.player_id, benchSlot]
    );

    // Log
    await query(
      `INSERT INTO roster_transactions (league_id, user_id, team_id, player_id, type, detail)
       VALUES ($1, $2, $3, $4, 'add', $5)`,
      [leagueId, req.user!.id, body.team_id, body.player_id, `Commissioner add → ${benchSlot}`]
    );

    res.json({ message: 'Player added by commissioner', player_id: body.player_id, team_id: body.team_id, slot: benchSlot });

  } else {
    // DROP
    const { rows: [rosterEntry] } = await query(
      'SELECT roster_slot FROM rosters WHERE team_id = $1 AND player_id = $2',
      [body.team_id, body.player_id]
    );
    if (!rosterEntry) { res.status(404).json({ error: 'Player not on this team roster.' }); return; }

    await query(
      'DELETE FROM rosters WHERE team_id = $1 AND player_id = $2',
      [body.team_id, body.player_id]
    );

    await query(
      `INSERT INTO roster_transactions (league_id, user_id, team_id, player_id, type, detail)
       VALUES ($1, $2, $3, $4, 'drop', $5)`,
      [leagueId, req.user!.id, body.team_id, body.player_id,
       `Commissioner drop${rosterEntry.roster_slot ? ' from ' + rosterEntry.roster_slot : ''}`]
    );

    res.json({ message: 'Player dropped by commissioner', player_id: body.player_id, team_id: body.team_id });
  }
});

// =============================================
// PATCH /api/leagues/:id/commissioner/matchup/:matchupId
// Override matchup score. Corrects standings for regular season matchups.
// =============================================
router.patch('/matchup/:matchupId', async (req: AuthRequest, res: Response): Promise<void> => {
  const Schema = z.object({
    home_score: z.number().min(0),
    away_score: z.number().min(0),
  });

  let body: z.infer<typeof Schema>;
  try { body = Schema.parse(req.body); }
  catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ error: 'Validation failed', details: err.errors }); return; }
    throw err;
  }

  const leagueId = req.params.id as string;
  const matchupId = req.params.matchupId as string;

  // Fetch the matchup
  const { rows: [matchup] } = await query(
    'SELECT * FROM matchups WHERE id = $1 AND league_id = $2',
    [matchupId, leagueId]
  );
  if (!matchup) { res.status(404).json({ error: 'Matchup not found in this league.' }); return; }

  const oldHomeScore = Number(matchup.home_score) || 0;
  const oldAwayScore = Number(matchup.away_score) || 0;
  const oldWinnerId = matchup.winner_team_id as string | null;
  const wasComplete = matchup.is_complete as boolean;
  const isPlayoffs = matchup.is_playoffs as boolean;

  // Determine new winner
  const newHomeScore = Math.round(body.home_score * 100) / 100;
  const newAwayScore = Math.round(body.away_score * 100) / 100;
  let newWinnerId: string | null = null;
  if (newHomeScore > newAwayScore) newWinnerId = matchup.home_team_id as string;
  else if (newAwayScore > newHomeScore) newWinnerId = matchup.away_team_id as string;

  const homeTeamId = matchup.home_team_id as string;
  const awayTeamId = matchup.away_team_id as string;

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Reverse old standings impact (only for completed regular season matchups)
    if (wasComplete && !isPlayoffs) {
      // Reverse old W/L/T
      if (oldWinnerId === homeTeamId) {
        await client.query('UPDATE teams SET wins = wins - 1 WHERE id = $1', [homeTeamId]);
        await client.query('UPDATE teams SET losses = losses - 1 WHERE id = $1', [awayTeamId]);
      } else if (oldWinnerId === awayTeamId) {
        await client.query('UPDATE teams SET wins = wins - 1 WHERE id = $1', [awayTeamId]);
        await client.query('UPDATE teams SET losses = losses - 1 WHERE id = $1', [homeTeamId]);
      } else {
        // Was a tie
        await client.query('UPDATE teams SET ties = ties - 1 WHERE id = $1', [homeTeamId]);
        await client.query('UPDATE teams SET ties = ties - 1 WHERE id = $1', [awayTeamId]);
      }

      // Reverse old PF/PA
      await client.query(
        'UPDATE teams SET points_for = points_for - $2, points_against = points_against - $3 WHERE id = $1',
        [homeTeamId, oldHomeScore, oldAwayScore]
      );
      await client.query(
        'UPDATE teams SET points_for = points_for - $2, points_against = points_against - $3 WHERE id = $1',
        [awayTeamId, oldAwayScore, oldHomeScore]
      );
    }

    // Apply new standings impact (for regular season matchups)
    if (!isPlayoffs) {
      if (newWinnerId === homeTeamId) {
        await client.query('UPDATE teams SET wins = wins + 1 WHERE id = $1', [homeTeamId]);
        await client.query('UPDATE teams SET losses = losses + 1 WHERE id = $1', [awayTeamId]);
      } else if (newWinnerId === awayTeamId) {
        await client.query('UPDATE teams SET wins = wins + 1 WHERE id = $1', [awayTeamId]);
        await client.query('UPDATE teams SET losses = losses + 1 WHERE id = $1', [homeTeamId]);
      } else {
        // Tie
        await client.query('UPDATE teams SET ties = ties + 1 WHERE id = $1', [homeTeamId]);
        await client.query('UPDATE teams SET ties = ties + 1 WHERE id = $1', [awayTeamId]);
      }

      // Apply new PF/PA
      await client.query(
        'UPDATE teams SET points_for = points_for + $2, points_against = points_against + $3 WHERE id = $1',
        [homeTeamId, newHomeScore, newAwayScore]
      );
      await client.query(
        'UPDATE teams SET points_for = points_for + $2, points_against = points_against + $3 WHERE id = $1',
        [awayTeamId, newAwayScore, newHomeScore]
      );
    }

    // Update matchup
    await client.query(
      `UPDATE matchups
       SET home_score = $1, away_score = $2, winner_team_id = $3,
           is_complete = TRUE, scoring_source = 'commissioner', updated_at = NOW()
       WHERE id = $4`,
      [newHomeScore, newAwayScore, newWinnerId, matchupId]
    );

    // Update team updated_at
    await client.query('UPDATE teams SET updated_at = NOW() WHERE id IN ($1, $2)', [homeTeamId, awayTeamId]);

    await client.query('COMMIT');

    res.json({
      message: 'Matchup score updated by commissioner',
      matchup_id: matchupId,
      home_score: newHomeScore,
      away_score: newAwayScore,
      winner_team_id: newWinnerId,
      old_home_score: oldHomeScore,
      old_away_score: oldAwayScore,
      old_winner_team_id: oldWinnerId,
      standings_corrected: !isPlayoffs,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

export default router;
