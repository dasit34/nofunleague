import { Router, Response } from 'express';
import { query } from '../config/database';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

// GET /api/teams/:id — team details with roster
router.get('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const { rows: [team] } = await query(
    `SELECT t.*, u.display_name, u.avatar_url, u.trash_talk_style
     FROM teams t LEFT JOIN users u ON u.id = t.user_id
     WHERE t.id = $1`,
    [req.params.id]
  );
  if (!team) { res.status(404).json({ error: 'Team not found' }); return; }

  const { rows: roster } = await query(
    `SELECT r.*, p.full_name, p.position, p.nfl_team, p.status, p.injury_status, p.jersey_number
     FROM rosters r JOIN players p ON p.id = r.player_id
     WHERE r.team_id = $1
     ORDER BY p.position, p.full_name`,
    [req.params.id]
  );

  res.json({ ...team, roster });
});

// GET /api/teams/:id/scores — weekly score history
router.get('/:id/scores', authenticate, async (req: AuthRequest, res: Response) => {
  const { rows } = await query(
    `SELECT ws.*, p.full_name as highest_scorer_name, b.full_name as biggest_bust_name
     FROM weekly_scores ws
     LEFT JOIN players p ON p.id = ws.highest_scorer_id
     LEFT JOIN players b ON b.id = ws.biggest_bust_id
     WHERE ws.team_id = $1
     ORDER BY ws.week DESC`,
    [req.params.id]
  );
  res.json(rows);
});

// GET /api/teams/:id/matchup-history
router.get('/:id/matchup-history', authenticate, async (req: AuthRequest, res: Response) => {
  const { rows } = await query(
    `SELECT m.*,
       ht.name as home_name, at.name as away_name,
       CASE WHEN m.home_team_id = $1 THEN m.home_score ELSE m.away_score END as my_score,
       CASE WHEN m.home_team_id = $1 THEN m.away_score ELSE m.home_score END as opp_score,
       CASE WHEN m.winner_team_id = $1 THEN true ELSE false END as won
     FROM matchups m
     JOIN teams ht ON ht.id = m.home_team_id
     JOIN teams at ON at.id = m.away_team_id
     WHERE (m.home_team_id = $1 OR m.away_team_id = $1) AND m.is_complete = TRUE
     ORDER BY m.week DESC`,
    [req.params.id]
  );
  res.json(rows);
});

export default router;
