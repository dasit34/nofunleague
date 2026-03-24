import { Router, Response } from 'express';
import { z } from 'zod';
import { query } from '../config/database';
import { authenticate, AuthRequest } from '../middleware/auth';
import { requireCommissioner } from '../middleware/commissioner';
import {
  getSleeperLeague,
  getSleeperRosters,
  getSleeperUsers,
  getSleeperMatchups,
  getNFLState,
} from '../services/sleeperService';

const router = Router();

// =============================================
// GET /api/leagues — list leagues for current user
// =============================================
router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  const { rows } = await query(
    `SELECT l.*, t.name as team_name
     FROM leagues l
     LEFT JOIN teams t ON t.league_id = l.id AND t.user_id = $1
     ORDER BY l.created_at DESC`,
    [req.user!.id]
  );
  res.json(rows);
});

// =============================================
// POST /api/leagues — create league
// =============================================
router.post('/', authenticate, async (req: AuthRequest, res: Response) => {
  const Schema = z.object({
    name:             z.string().min(1).max(100),
    sleeper_league_id: z.string().optional(),
    season:           z.number().optional(),
    ai_enabled:       z.boolean().optional(),
  });

  const body = Schema.parse(req.body);
  const { rows } = await query(
    `INSERT INTO leagues (name, commissioner_id, sleeper_league_id, season, ai_enabled)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [body.name, req.user!.id, body.sleeper_league_id || null, body.season || 2025, body.ai_enabled ?? true]
  );
  res.status(201).json(rows[0]);
});

// =============================================
// GET /api/leagues/:id — league details with teams
// Only accessible to commissioner or league members
// =============================================
router.get('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const { rows: [league] } = await query('SELECT * FROM leagues WHERE id = $1', [req.params.id]);
  if (!league) { res.status(404).json({ error: 'League not found' }); return; }

  // Authorization: commissioner or member (has a team in this league)
  const isCommissioner = league.commissioner_id === req.user!.id;
  if (!isCommissioner) {
    const { rows: [membership] } = await query(
      'SELECT id FROM teams WHERE league_id = $1 AND user_id = $2',
      [league.id, req.user!.id]
    );
    if (!membership) {
      res.status(403).json({ error: 'You are not a member of this league' });
      return;
    }
  }

  const { rows: teams } = await query(
    `SELECT t.*, u.display_name, u.avatar_url, u.trash_talk_style
     FROM teams t
     LEFT JOIN users u ON u.id = t.user_id
     WHERE t.league_id = $1
     ORDER BY t.wins DESC, t.points_for DESC`,
    [req.params.id]
  );

  res.json({ ...league, teams });
});

// =============================================
// PATCH /api/leagues/:id — commissioner updates week or status
// =============================================
router.patch('/:id', authenticate, requireCommissioner, async (req: AuthRequest, res: Response) => {
  const Schema = z.object({
    week:   z.number().int().min(1).max(22).optional(),
    status: z.enum(['pre_draft', 'drafting', 'in_season', 'post_season', 'complete']).optional(),
  });

  const body = Schema.parse(req.body);

  const sets: string[] = [];
  const params: unknown[] = [];

  if (body.week !== undefined)   { sets.push(`week = $${params.length + 1}`);   params.push(body.week); }
  if (body.status !== undefined) { sets.push(`status = $${params.length + 1}`); params.push(body.status); }

  if (sets.length === 0) { res.status(400).json({ error: 'Nothing to update' }); return; }

  params.push(req.params.id);
  const { rows: [updated] } = await query(
    `UPDATE leagues SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length} RETURNING *`,
    params
  );
  res.json(updated);
});

// =============================================
// POST /api/leagues/:id/sync-sleeper — commissioner only
// Syncs teams, rosters, W-L, and league week from Sleeper.
// Also attempts to link teams to local user accounts via sleeper_user_id.
// =============================================
router.post('/:id/sync-sleeper', authenticate, requireCommissioner, async (req: AuthRequest, res: Response) => {
  try {
    const { rows: [league] } = await query('SELECT * FROM leagues WHERE id = $1', [req.params.id]);
    if (!league) { res.status(404).json({ error: 'League not found' }); return; }
    if (!league.sleeper_league_id) { res.status(400).json({ error: 'No Sleeper league ID linked' }); return; }

    const [sleeperLeague, rosters, sleeperUsers, nflState] = await Promise.all([
      getSleeperLeague(league.sleeper_league_id),
      getSleeperRosters(league.sleeper_league_id),
      getSleeperUsers(league.sleeper_league_id),
      getNFLState(),
    ]);

    const userMap = new Map(sleeperUsers.map(u => [u.user_id, u]));

    // Derive current week and scoring format from Sleeper
    const currentWeek    = (sleeperLeague.settings?.leg as number) || parseInt(nflState.week as unknown as string) || league.week;
    const recPoints      = (sleeperLeague.settings?.rec as number) ?? -1;
    const scoringFormat  = recPoints === 1 ? 'ppr' : recPoints === 0.5 ? 'half_ppr' : 'standard';

    // Update league metadata
    await query(
      `UPDATE leagues
       SET status   = $1,
           week     = $2,
           settings = settings || $3,
           updated_at = NOW()
       WHERE id = $4`,
      [
        sleeperLeague.status || league.status,
        currentWeek,
        JSON.stringify({
          scoring_format:    scoringFormat,
          roster_positions:  sleeperLeague.roster_positions || [],
          total_rosters:     sleeperLeague.total_rosters,
        }),
        league.id,
      ]
    );

    let syncedRosters = 0;
    let syncedPlayers = 0;
    let linkedUsers   = 0;

    for (const roster of rosters) {
      const sleeperUser = userMap.get(roster.owner_id);
      if (!sleeperUser) continue;

      const winsTotal  = roster.settings?.wins    || 0;
      const lossesTotal= roster.settings?.losses  || 0;
      const tiesTotal  = roster.settings?.ties    || 0;
      const ptsFor     = (roster.settings?.fpts || 0) + (roster.settings?.fpts_decimal || 0) / 100;
      const ptsAgainst = (roster.settings?.fpts_against || 0) + (roster.settings?.fpts_against_decimal || 0) / 100;

      // Upsert team by sleeper_roster_id
      const { rows: [team] } = await query(
        `INSERT INTO teams (league_id, name, sleeper_roster_id, wins, losses, ties, points_for, points_against)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (league_id, sleeper_roster_id) DO UPDATE SET
           name           = EXCLUDED.name,
           wins           = EXCLUDED.wins,
           losses         = EXCLUDED.losses,
           ties           = EXCLUDED.ties,
           points_for     = EXCLUDED.points_for,
           points_against = EXCLUDED.points_against,
           updated_at     = NOW()
         RETURNING id`,
        [league.id, sleeperUser.display_name || sleeperUser.username, roster.roster_id,
         winsTotal, lossesTotal, tiesTotal, ptsFor, ptsAgainst]
      );

      if (!team) continue;

      // Link this team to a local user account if their sleeper_user_id matches
      const { rowCount } = await query(
        `UPDATE teams
         SET user_id = u.id
         FROM users u
         WHERE teams.id = $1
           AND u.sleeper_user_id = $2`,
        [team.id, sleeperUser.user_id]
      );
      if (rowCount && rowCount > 0) linkedUsers++;

      // Sync roster — wipe and rebuild from Sleeper
      if (roster.players?.length) {
        await query('DELETE FROM rosters WHERE team_id = $1', [team.id]);

        for (const playerId of roster.players) {
          const isStarter = (roster.starters || []).includes(playerId);
          await query(
            `INSERT INTO rosters (team_id, player_id, is_starter)
             SELECT $1, $2, $3
             WHERE EXISTS (SELECT 1 FROM players WHERE id = $2)
             ON CONFLICT (team_id, player_id) DO UPDATE SET is_starter = EXCLUDED.is_starter`,
            [team.id, playerId, isStarter]
          );
          syncedPlayers++;
        }
      }

      syncedRosters++;
    }

    res.json({
      message:             'Sync complete',
      week:                currentWeek,
      scoring_format:      scoringFormat,
      synced_rosters:      syncedRosters,
      synced_player_slots: syncedPlayers,
      linked_users:        linkedUsers,
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Sleeper sync failed';
    res.status(502).json({ error: `Sleeper sync failed: ${msg}` });
  }
});

// =============================================
// GET /api/leagues/:id/matchups/:week
// Members only
// =============================================
router.get('/:id/matchups/:week', authenticate, async (req: AuthRequest, res: Response) => {
  const leagueId = req.params.id as string;

  const { rows: [league] } = await query(
    'SELECT commissioner_id FROM leagues WHERE id = $1', [leagueId]
  );
  if (!league) { res.status(404).json({ error: 'League not found' }); return; }

  if (league.commissioner_id !== req.user!.id) {
    const { rows: [membership] } = await query(
      'SELECT id FROM teams WHERE league_id = $1 AND user_id = $2',
      [leagueId, req.user!.id]
    );
    if (!membership) {
      res.status(403).json({ error: 'You are not a member of this league' });
      return;
    }
  }

  const week = parseInt(req.params.week as string);
  const { rows } = await query(
    `SELECT m.*,
       ht.name as home_team_name, at.name as away_team_name,
       hu.display_name as home_owner, au.display_name as away_owner
     FROM matchups m
     JOIN teams ht ON ht.id = m.home_team_id
     JOIN teams at ON at.id = m.away_team_id
     LEFT JOIN users hu ON hu.id = ht.user_id
     LEFT JOIN users au ON au.id = at.user_id
     WHERE m.league_id = $1 AND m.week = $2
     ORDER BY m.home_score DESC`,
    [req.params.id, week]
  );
  res.json(rows);
});

// =============================================
// POST /api/leagues/:id/import-matchups/:week — commissioner only
// Fetches matchup data from Sleeper, upserts matchup records,
// marks each matchup complete with a determined winner,
// and updates weekly_scores including top/bust scorers.
// =============================================
router.post('/:id/import-matchups/:week', authenticate, requireCommissioner, async (req: AuthRequest, res: Response) => {
  try {
    const { rows: [league] } = await query('SELECT * FROM leagues WHERE id = $1', [req.params.id]);
    if (!league?.sleeper_league_id) { res.status(400).json({ error: 'No Sleeper league ID linked' }); return; }

    const week = parseInt(req.params.week as string);
    const sleeperMatchups = await getSleeperMatchups(league.sleeper_league_id, week);

    // Group by matchup_id — Sleeper returns one record per team
    const groups = new Map<number, typeof sleeperMatchups>();
    for (const m of sleeperMatchups) {
      if (!groups.has(m.matchup_id)) groups.set(m.matchup_id, []);
      groups.get(m.matchup_id)!.push(m);
    }

    let imported = 0;

    for (const [matchupId, pair] of groups) {
      if (pair.length !== 2) continue;
      const [home, away] = pair;

      const { rows: [homeTeam] } = await query(
        'SELECT id FROM teams WHERE league_id = $1 AND sleeper_roster_id = $2',
        [league.id, home.roster_id]
      );
      const { rows: [awayTeam] } = await query(
        'SELECT id FROM teams WHERE league_id = $1 AND sleeper_roster_id = $2',
        [league.id, away.roster_id]
      );
      if (!homeTeam || !awayTeam) continue;

      const homeScore = home.points || 0;
      const awayScore = away.points || 0;

      // Determine winner — null on tie
      let winnerId: string | null = null;
      if (homeScore > awayScore)      winnerId = homeTeam.id;
      else if (awayScore > homeScore) winnerId = awayTeam.id;

      // Upsert matchup with winner and completion flag
      await query(
        `INSERT INTO matchups
           (league_id, week, home_team_id, away_team_id, home_score, away_score,
            winner_team_id, is_complete, sleeper_matchup_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, $8)
         ON CONFLICT (league_id, week, home_team_id, away_team_id) DO UPDATE SET
           home_score     = EXCLUDED.home_score,
           away_score     = EXCLUDED.away_score,
           winner_team_id = EXCLUDED.winner_team_id,
           is_complete    = TRUE,
           updated_at     = NOW()`,
        [league.id, week, homeTeam.id, awayTeam.id, homeScore, awayScore, winnerId, matchupId]
      );

      // Build player score arrays and find top/bust scorers
      const homeScores = buildPlayerScores(home.players_points || {}, home.starters || []);
      const awayScores = buildPlayerScores(away.players_points || {}, away.starters || []);

      const homeTopId  = findTopScorerId(home.players_points || {}, home.starters || []);
      const homeBustId = findBustScorerId(home.players_points || {}, home.starters || []);
      const awayTopId  = findTopScorerId(away.players_points || {}, away.starters || []);
      const awayBustId = findBustScorerId(away.players_points || {}, away.starters || []);

      // Upsert weekly_scores for both teams
      await query(
        `INSERT INTO weekly_scores
           (team_id, league_id, week, total_points, player_scores, highest_scorer_id, biggest_bust_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (team_id, week) DO UPDATE SET
           total_points       = EXCLUDED.total_points,
           player_scores      = EXCLUDED.player_scores,
           highest_scorer_id  = EXCLUDED.highest_scorer_id,
           biggest_bust_id    = EXCLUDED.biggest_bust_id,
           updated_at         = NOW()`,
        [homeTeam.id, league.id, week, homeScore, JSON.stringify(homeScores),
         await resolvePlayerId(homeTopId), await resolvePlayerId(homeBustId)]
      );

      await query(
        `INSERT INTO weekly_scores
           (team_id, league_id, week, total_points, player_scores, highest_scorer_id, biggest_bust_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (team_id, week) DO UPDATE SET
           total_points       = EXCLUDED.total_points,
           player_scores      = EXCLUDED.player_scores,
           highest_scorer_id  = EXCLUDED.highest_scorer_id,
           biggest_bust_id    = EXCLUDED.biggest_bust_id,
           updated_at         = NOW()`,
        [awayTeam.id, league.id, week, awayScore, JSON.stringify(awayScores),
         await resolvePlayerId(awayTopId), await resolvePlayerId(awayBustId)]
      );

      imported++;
    }

    res.json({ message: `Imported ${imported} matchups for week ${week}`, week, imported });

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Import failed';
    res.status(502).json({ error: `Matchup import failed: ${msg}` });
  }
});

// =============================================
// Helpers
// =============================================

function buildPlayerScores(
  playersPoints: Record<string, number>,
  starters: string[]
): Array<{ player_id: string; points: number; is_starter: boolean }> {
  return Object.entries(playersPoints).map(([player_id, points]) => ({
    player_id,
    points,
    is_starter: starters.includes(player_id),
  }));
}

function findTopScorerId(playersPoints: Record<string, number>, starters: string[]): string | null {
  const starterPoints = starters
    .filter(pid => playersPoints[pid] !== undefined)
    .map(pid => ({ pid, pts: playersPoints[pid] }));
  if (!starterPoints.length) return null;
  return starterPoints.reduce((a, b) => b.pts > a.pts ? b : a).pid;
}

function findBustScorerId(playersPoints: Record<string, number>, starters: string[]): string | null {
  // Biggest bust = lowest-scoring starter who actually played (points > 0)
  const active = starters
    .filter(pid => playersPoints[pid] !== undefined && playersPoints[pid] > 0)
    .map(pid => ({ pid, pts: playersPoints[pid] }));
  if (!active.length) return null;
  return active.reduce((a, b) => b.pts < a.pts ? b : a).pid;
}

/** Returns player_id only if the player exists in our local cache — null otherwise. */
async function resolvePlayerId(playerId: string | null): Promise<string | null> {
  if (!playerId) return null;
  const { rows } = await query('SELECT id FROM players WHERE id = $1', [playerId]);
  return rows.length ? playerId : null;
}

export default router;
