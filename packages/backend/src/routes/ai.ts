import { Router, Response } from 'express';
import { z } from 'zod';
import { query } from '../config/database';
import { authenticate, AuthRequest } from '../middleware/auth';
import {
  generateTrashTalk,
  generateWeeklyRecap,
  generateDraftCommentary,
  generateTradeReaction,
  generateLineupAdvice,
  generateWaiverRecommendations,
  type LineupAdviceContext,
  type WaiverRecsContext,
} from '../services/anthropicService';

const router = Router();

// POST /api/ai/trash-talk — generate AI trash talk for a matchup
router.post('/trash-talk', authenticate, async (req: AuthRequest, res: Response) => {
  const Schema = z.object({
    league_id: z.string().uuid(),
    matchup_id: z.string().uuid(),
    target_team_id: z.string().uuid(),
    style: z.enum(['aggressive', 'petty', 'poetic', 'silent']).optional(),
  });

  const body = Schema.parse(req.body);

  // Fetch matchup context
  const { rows: [matchup] } = await query(
    `SELECT m.*,
       ht.name as home_name, at.name as away_name,
       hu.display_name as home_owner, au.display_name as away_owner,
       hu.trash_talk_style as home_style, au.trash_talk_style as away_style
     FROM matchups m
     JOIN teams ht ON ht.id = m.home_team_id
     JOIN teams at ON at.id = m.away_team_id
     LEFT JOIN users hu ON hu.id = ht.user_id
     LEFT JOIN users au ON au.id = at.user_id
     WHERE m.id = $1 AND m.league_id = $2`,
    [body.matchup_id, body.league_id]
  );

  if (!matchup) { res.status(404).json({ error: 'Matchup not found' }); return; }

  const isHome = matchup.home_team_id === body.target_team_id;
  const targetScore = isHome ? matchup.home_score : matchup.away_score;
  const opponentScore = isHome ? matchup.away_score : matchup.home_score;

  const ctx = {
    targetTeamName: isHome ? matchup.home_name : matchup.away_name,
    targetOwnerName: isHome ? matchup.home_owner : matchup.away_owner,
    targetScore: parseFloat(targetScore),
    opponentTeamName: isHome ? matchup.away_name : matchup.home_name,
    opponentScore: parseFloat(opponentScore),
    week: matchup.week,
    style: body.style || (isHome ? matchup.home_style : matchup.away_style) || 'aggressive',
  };

  const text = await generateTrashTalk(ctx);

  // Log to chat and ai_generations
  await Promise.all([
    query(
      `INSERT INTO league_chat (league_id, is_ai, ai_target_team_id, message, message_type, week)
       VALUES ($1, TRUE, $2, $3, 'trash_talk', $4)`,
      [body.league_id, body.target_team_id, text, matchup.week]
    ),
    query(
      `INSERT INTO ai_generations (league_id, generation_type, model, input_context, output_text)
       VALUES ($1, 'trash_talk', 'claude-sonnet-4-20250514', $2, $3)`,
      [body.league_id, JSON.stringify(ctx), text]
    ),
  ]);

  res.json({ text, context: ctx });
});

// POST /api/ai/weekly-recap — generate weekly recap
router.post('/weekly-recap', authenticate, async (req: AuthRequest, res: Response) => {
  const Schema = z.object({
    league_id: z.string().uuid(),
    week: z.number().min(1).max(18),
  });

  const body = Schema.parse(req.body);

  // Fetch completed matchups for the week
  const { rows: matchups } = await query(
    `SELECT m.*,
       ht.name as home_name, at.name as away_name,
       m.home_score, m.away_score
     FROM matchups m
     JOIN teams ht ON ht.id = m.home_team_id
     JOIN teams at ON at.id = m.away_team_id
     WHERE m.league_id = $1 AND m.week = $2`,
    [body.league_id, body.week]
  );

  const { rows: [league] } = await query('SELECT name FROM leagues WHERE id = $1', [body.league_id]);

  if (!matchups.length) { res.status(404).json({ error: 'No matchups found for this week' }); return; }

  const scores = matchups.flatMap(m => [
    { team: m.home_name, score: parseFloat(m.home_score) },
    { team: m.away_name, score: parseFloat(m.away_score) },
  ]);

  const highest = scores.reduce((a, b) => a.score > b.score ? a : b);
  const lowest = scores.reduce((a, b) => a.score < b.score ? a : b);
  const avg = scores.reduce((sum, s) => sum + s.score, 0) / scores.length;

  const ctx = {
    week: body.week,
    leagueName: league.name,
    matchups: matchups.map(m => ({
      winnerTeam: parseFloat(m.home_score) > parseFloat(m.away_score) ? m.home_name : m.away_name,
      winnerScore: Math.max(parseFloat(m.home_score), parseFloat(m.away_score)),
      loserTeam: parseFloat(m.home_score) > parseFloat(m.away_score) ? m.away_name : m.home_name,
      loserScore: Math.min(parseFloat(m.home_score), parseFloat(m.away_score)),
    })),
    highestScore: highest,
    lowestScore: lowest,
    leagueAvgScore: avg,
  };

  const text = await generateWeeklyRecap(ctx);

  await Promise.all([
    query(
      `INSERT INTO league_chat (league_id, is_ai, message, message_type, week)
       VALUES ($1, TRUE, $2, 'weekly_recap', $3)`,
      [body.league_id, text, body.week]
    ),
    query(
      `INSERT INTO ai_generations (league_id, generation_type, model, input_context, output_text)
       VALUES ($1, 'weekly_recap', 'claude-sonnet-4-20250514', $2, $3)`,
      [body.league_id, JSON.stringify(ctx), text]
    ),
  ]);

  res.json({ text });
});

// POST /api/ai/draft-commentary
router.post('/draft-commentary', authenticate, async (_req: AuthRequest, res: Response) => {
  // Phase 1: Basic draft commentary hook
  res.json({ message: 'Draft commentary endpoint ready', text: '' });
});

// POST /api/ai/trade-reaction
router.post('/trade-reaction', authenticate, async (req: AuthRequest, res: Response) => {
  const Schema = z.object({
    league_id: z.string().uuid(),
    team1_name: z.string(),
    team1_giving: z.array(z.string()),
    team2_name: z.string(),
    team2_giving: z.array(z.string()),
  });

  const body = Schema.parse(req.body);

  const text = await generateTradeReaction({
    team1Name: body.team1_name,
    team1Giving: body.team1_giving,
    team2Name: body.team2_name,
    team2Giving: body.team2_giving,
  });

  res.json({ text });
});

// GET /api/ai/lineup-advice/:teamId/:week
router.get('/lineup-advice/:teamId/:week', authenticate, async (req: AuthRequest, res: Response) => {
  const teamId = req.params.teamId as string;
  const week = parseInt(req.params.week as string);

  // Fetch team + league info
  const { rows: [team] } = await query(
    `SELECT t.name, t.league_id, u.display_name, l.season, l.id as league_id
     FROM teams t
     LEFT JOIN users u ON u.id = t.user_id
     JOIN leagues l ON l.id = t.league_id
     WHERE t.id = $1`,
    [teamId]
  );
  if (!team) { res.status(404).json({ error: 'Team not found' }); return; }

  const prevWeekStart = Math.max(1, week - 3);
  const prevWeekEnd = Math.max(1, week - 1);

  // Fetch roster with projected stats for this week and 3-week average
  const { rows: roster } = await query(
    `SELECT
       r.is_starter, r.roster_slot,
       p.full_name, p.position, p.nfl_team, p.injury_status,
       COALESCE(ps.fantasy_pts_ppr, 0)::float AS projected,
       COALESCE(
         (SELECT AVG(ps2.fantasy_pts_ppr)
          FROM player_stats ps2
          WHERE ps2.player_id = p.id
            AND ps2.season = $2
            AND ps2.week BETWEEN $3 AND $4
            AND ps2.season_type = 'regular'),
         0
       )::float AS last3_avg
     FROM rosters r
     JOIN players p ON p.id = r.player_id
     LEFT JOIN player_stats ps ON ps.player_id = p.id
       AND ps.season = $2 AND ps.week = $5 AND ps.season_type = 'regular'
     WHERE r.team_id = $1
     ORDER BY r.is_starter DESC, r.roster_slot`,
    [teamId, team.season, prevWeekStart, prevWeekEnd, week]
  );

  const mapPlayer = (p: Record<string, unknown>) => ({
    slot: (p.roster_slot as string) || 'BN',
    playerName: p.full_name as string,
    position: p.position as string,
    nflTeam: (p.nfl_team as string) || 'FA',
    projected: p.projected as number,
    last3Avg: p.last3_avg as number,
    injuryStatus: p.injury_status as string | undefined,
  });

  const ctx: LineupAdviceContext = {
    teamName: team.name,
    ownerName: team.display_name || 'Manager',
    week,
    starters: roster.filter((p: Record<string, unknown>) => p.is_starter).map(mapPlayer),
    bench: roster.filter((p: Record<string, unknown>) => !p.is_starter).map(mapPlayer),
  };

  const text = await generateLineupAdvice(ctx);

  // Log generation
  await query(
    `INSERT INTO ai_generations (league_id, generation_type, model, input_context, output_text)
     VALUES ($1, 'lineup_advice', 'claude-sonnet-4-20250514', $2, $3)`,
    [team.league_id, JSON.stringify(ctx), text]
  );

  res.json({ text });
});

// GET /api/ai/waiver-recs/:leagueId/:week
router.get('/waiver-recs/:leagueId/:week', authenticate, async (req: AuthRequest, res: Response) => {
  const leagueId = req.params.leagueId as string;
  const week = parseInt(req.params.week as string);

  const { rows: [league] } = await query('SELECT * FROM leagues WHERE id = $1', [leagueId]);
  if (!league) { res.status(404).json({ error: 'League not found' }); return; }

  const prevWeekStart = Math.max(1, week - 3);
  const prevWeekEnd = Math.max(1, week - 1);

  // Find active players NOT on any roster in this league, sorted by recent production
  const { rows: available } = await query(
    `SELECT
       p.full_name, p.position, p.nfl_team, p.injury_status,
       COALESCE(ps.fantasy_pts_ppr, 0)::float AS projected,
       COALESCE(
         (SELECT AVG(ps2.fantasy_pts_ppr)
          FROM player_stats ps2
          WHERE ps2.player_id = p.id
            AND ps2.season = $2
            AND ps2.week BETWEEN $3 AND $4
            AND ps2.season_type = 'regular'),
         0
       )::float AS last3_avg
     FROM players p
     LEFT JOIN player_stats ps ON ps.player_id = p.id
       AND ps.season = $2 AND ps.week = $5 AND ps.season_type = 'regular'
     WHERE p.position IN ('QB', 'RB', 'WR', 'TE', 'K', 'DEF')
       AND (p.status = 'Active' OR p.status IS NULL)
       AND p.injury_status NOT IN ('IR', 'O') OR p.injury_status IS NULL
       AND p.id NOT IN (
         SELECT r.player_id FROM rosters r
         JOIN teams t ON t.id = r.team_id
         WHERE t.league_id = $1
       )
     ORDER BY COALESCE(ps.fantasy_pts_ppr, 0) DESC, last3_avg DESC
     LIMIT 30`,
    [leagueId, league.season, prevWeekStart, prevWeekEnd, week]
  );

  const availablePlayers = available.map((p: Record<string, unknown>) => ({
    playerName: p.full_name as string,
    position: p.position as string,
    nflTeam: (p.nfl_team as string) || 'FA',
    projected: p.projected as number,
    last3Avg: p.last3_avg as number,
    injuryStatus: p.injury_status as string | undefined,
  }));

  const ctx: WaiverRecsContext = {
    leagueName: league.name,
    week,
    scoringFormat: 'PPR',
    availablePlayers,
  };

  const text = await generateWaiverRecommendations(ctx);

  await query(
    `INSERT INTO ai_generations (league_id, generation_type, model, input_context, output_text)
     VALUES ($1, 'waiver_recs', 'claude-sonnet-4-20250514', $2, $3)`,
    [leagueId, JSON.stringify({ week, playerCount: availablePlayers.length }), text]
  );

  res.json({ text, players: availablePlayers.slice(0, 10) });
});

export default router;
