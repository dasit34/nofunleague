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

// GET /api/ai/lineup-advice/:teamId/:week — Phase 2 placeholder
router.get('/lineup-advice/:teamId/:week', authenticate, async (req: AuthRequest, res: Response) => {
  const text = await generateLineupAdvice(req.params.teamId, parseInt(req.params.week));
  res.json({ text });
});

// GET /api/ai/waiver-recs/:leagueId/:week — Phase 3 placeholder
router.get('/waiver-recs/:leagueId/:week', authenticate, async (req: AuthRequest, res: Response) => {
  const text = await generateWaiverRecommendations(req.params.leagueId, parseInt(req.params.week));
  res.json({ text });
});

export default router;
