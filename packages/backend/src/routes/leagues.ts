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
import { scoreWeekReal, persistWeeklyScores, getTeamWeeklyScore, type PlayerScore } from '../services/scoringService';
import { DEFAULT_ROSTER, getRosterSettings, totalRosterSize, type RosterSettings } from '../config/rosterConfig';
import {
  mergeWithDefaults,
  createDefaultSettings,
  type LeagueSettings,
  RosterSettingsSchema,
} from '../config/leagueSettings';
import * as settingsService from '../services/settingsService';
import { generateFirstRoundBracket, advancePlayoffRound, checkForChampion, type GeneratedBracket, type AdvancementResult } from '../services/playoffService';

const router = Router();

// =============================================
// GET /api/leagues — list leagues for current user
// Only returns leagues where the user is commissioner or has a team
// =============================================
router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  const { rows } = await query(
    `SELECT DISTINCT ON (l.id) l.*, t.name AS team_name
     FROM   leagues l
     LEFT JOIN teams t ON t.league_id = l.id AND t.user_id = $1
     LEFT JOIN league_members lm ON lm.league_id = l.id AND lm.user_id = $1
     WHERE  l.commissioner_id = $1
        OR  t.id IS NOT NULL
        OR  lm.id IS NOT NULL
     ORDER BY l.id, l.created_at DESC`,
    [req.user!.id]
  );
  res.json(rows);
});

// =============================================
// POST /api/leagues — create league
// =============================================
router.post('/', authenticate, async (req: AuthRequest, res: Response) => {
  const Schema = z.object({
    name:              z.string().min(1).max(100),
    sleeper_league_id: z.string().optional(),
    season:            z.number().optional(),
    ai_enabled:        z.boolean().optional(),
    league_size:       z.number().int().min(4).max(16).optional(),
    scoring_type:      z.enum(['standard', 'half_ppr', 'ppr']).optional(),
    scoring_source:    z.enum(['mock', 'real']).optional(),
    roster_settings:   z.object({
      qb_slots:        z.number().int().min(0).max(4),
      rb_slots:        z.number().int().min(0).max(8),
      wr_slots:        z.number().int().min(0).max(8),
      te_slots:        z.number().int().min(0).max(4),
      flex_slots:      z.number().int().min(0).max(4),
      flex_types:      z.enum(['RB_WR', 'RB_WR_TE', 'QB_RB_WR_TE']),
      superflex_slots: z.number().int().min(0).max(2).default(0),
      k_slots:         z.number().int().min(0).max(2),
      def_slots:       z.number().int().min(0).max(2),
      bench_slots:     z.number().int().min(0).max(15),
      ir_slots:        z.number().int().min(0).max(5).default(0),
      max_qb:          z.number().int().min(0).max(10).default(0),
      max_rb:          z.number().int().min(0).max(10).default(0),
      max_wr:          z.number().int().min(0).max(10).default(0),
      max_te:          z.number().int().min(0).max(10).default(0),
      max_k:           z.number().int().min(0).max(5).default(0),
      max_def:         z.number().int().min(0).max(5).default(0),
    }).optional(),
  });

  const body = Schema.parse(req.body);
  const defaults = createDefaultSettings();
  const roster = body.roster_settings ? { ...defaults.roster, ...body.roster_settings } : defaults.roster;
  const scoringType = body.scoring_type ?? 'half_ppr';
  const scoringSource = body.scoring_source ?? 'mock';

  // Build the full initial settings JSONB
  const initialSettings: LeagueSettings = {
    ...defaults,
    roster,
    scoring: { ...defaults.scoring, type: scoringType as LeagueSettings['scoring']['type'], source: scoringSource as LeagueSettings['scoring']['source'] },
  };

  const inviteCode = Math.random().toString(36).substring(2, 10).toUpperCase();

  const { rows } = await query(
    `INSERT INTO leagues (name, commissioner_id, sleeper_league_id, season, ai_enabled, league_size, scoring_type, invite_code, scoring_source, settings)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      body.name,
      req.user!.id,
      body.sleeper_league_id || null,
      body.season || new Date().getFullYear(),
      body.ai_enabled ?? true,
      body.league_size ?? 10,
      scoringType,
      inviteCode,
      scoringSource,
      JSON.stringify(initialSettings),
    ]
  );

  // Auto-add commissioner as a league member
  await query(
    `INSERT INTO league_members (user_id, league_id, role) VALUES ($1, $2, 'commissioner')
     ON CONFLICT DO NOTHING`,
    [req.user!.id, rows[0].id]
  );

  res.status(201).json(rows[0]);
});

// =============================================
// POST /api/leagues/join — join a league by invite code
// =============================================
router.post('/join', authenticate, async (req: AuthRequest, res: Response) => {
  const Schema = z.object({
    invite_code: z.string().min(1),
  });

  let body: z.infer<typeof Schema>;
  try {
    body = Schema.parse(req.body);
  } catch {
    res.status(400).json({ error: 'invite_code is required' });
    return;
  }

  const { rows: [league] } = await query(
    'SELECT * FROM leagues WHERE invite_code = $1',
    [body.invite_code.toUpperCase()]
  );

  if (!league) {
    res.status(404).json({ error: 'Invalid invite code. No league found.' });
    return;
  }

  // Check if already a member
  const { rows: [existing] } = await query(
    'SELECT id, role FROM league_members WHERE user_id = $1 AND league_id = $2',
    [req.user!.id, league.id]
  );

  if (existing) {
    res.json({ message: 'Already a member', league_id: league.id, role: existing.role });
    return;
  }

  // Check league capacity
  const { rows: [{ count }] } = await query(
    'SELECT COUNT(*)::int AS count FROM league_members WHERE league_id = $1',
    [league.id]
  );
  if (league.league_size && count >= league.league_size) {
    res.status(400).json({ error: 'This league is full' });
    return;
  }

  // Add membership
  await query(
    `INSERT INTO league_members (user_id, league_id, role) VALUES ($1, $2, 'member')
     ON CONFLICT DO NOTHING`,
    [req.user!.id, league.id]
  );

  // Auto-create a team for the user if they don't have one
  const { rows: [existingTeam] } = await query(
    'SELECT id FROM teams WHERE league_id = $1 AND user_id = $2',
    [league.id, req.user!.id]
  );
  let team = existingTeam;
  if (!team) {
    const { rows: [newTeam] } = await query(
      `INSERT INTO teams (league_id, user_id, name)
       VALUES ($1, $2, $3)
       ON CONFLICT (league_id, user_id) DO NOTHING
       RETURNING *`,
      [league.id, req.user!.id, `${req.user!.username}'s Team`]
    );
    team = newTeam;
  }

  res.status(201).json({ message: 'Joined league successfully', league_id: league.id, role: 'member', team_id: team?.id });
});

// =============================================
// GET /api/leagues/:id — league details with teams and members
// Only accessible to commissioner or league members
// =============================================
router.get('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const { rows: [league] } = await query('SELECT * FROM leagues WHERE id = $1', [req.params.id]);
  if (!league) { res.status(404).json({ error: 'League not found' }); return; }

  // Authorization: commissioner or league member
  const isCommissioner = league.commissioner_id === req.user!.id;
  if (!isCommissioner) {
    const { rows: [membership] } = await query(
      'SELECT id FROM league_members WHERE league_id = $1 AND user_id = $2',
      [league.id, req.user!.id]
    );
    // Fallback: also check teams table for legacy membership
    if (!membership) {
      const { rows: [teamMembership] } = await query(
        'SELECT id FROM teams WHERE league_id = $1 AND user_id = $2',
        [league.id, req.user!.id]
      );
      if (!teamMembership) {
        res.status(403).json({ error: 'You are not a member of this league' });
        return;
      }
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

  const { rows: members } = await query(
    `SELECT lm.id, lm.role, lm.created_at,
            u.id AS user_id, u.username, u.display_name, u.avatar_url
     FROM league_members lm
     JOIN users u ON u.id = lm.user_id
     WHERE lm.league_id = $1
     ORDER BY lm.role = 'commissioner' DESC, lm.created_at ASC`,
    [req.params.id]
  );

  res.json({ ...league, teams, members });
});

// =============================================
// GET /api/leagues/:id/standings — computed standings from team records
// Sorted by wins DESC, points_for DESC, name ASC.
// =============================================
router.get('/:id/standings', authenticate, async (req: AuthRequest, res: Response) => {
  const leagueId = req.params.id as string;

  const { rows: [league] } = await query(
    'SELECT id, week, status, season FROM leagues WHERE id = $1',
    [leagueId]
  );
  if (!league) { res.status(404).json({ error: 'League not found' }); return; }

  const { rows: teams } = await query(
    `SELECT t.id, t.name, t.user_id, t.wins, t.losses, t.ties, t.points_for, t.points_against,
            u.display_name, u.avatar_url
     FROM teams t
     LEFT JOIN users u ON u.id = t.user_id
     WHERE t.league_id = $1
     ORDER BY t.wins DESC, t.points_for DESC, t.name ASC`,
    [leagueId]
  );

  const standings = teams.map((t: {
    id: string; name: string; user_id: string;
    wins: number; losses: number; ties: number;
    points_for: string; points_against: string;
    display_name: string | null; avatar_url: string | null;
  }, index: number) => ({
    rank: index + 1,
    team_id: t.id,
    team_name: t.name,
    user_id: t.user_id,
    display_name: t.display_name,
    wins: t.wins,
    losses: t.losses,
    ties: t.ties,
    record: `${t.wins}-${t.losses}${t.ties > 0 ? `-${t.ties}` : ''}`,
    points_for: parseFloat(t.points_for) || 0,
    points_against: parseFloat(t.points_against) || 0,
  }));

  res.json({
    league_id: leagueId,
    week: league.week,
    status: league.status,
    standings,
  });
});

// =============================================
// GET /api/leagues/:id/transactions — recent roster transactions
// =============================================
router.get('/:id/transactions', authenticate, async (req: AuthRequest, res: Response) => {
  const limit = parseInt((req.query.limit as string) || '20');
  const { rows } = await query(
    `SELECT rt.id, rt.type, rt.detail, rt.created_at,
            u.display_name AS user_name, u.username,
            t.name AS team_name,
            p.full_name AS player_name, p.position AS player_position, p.nfl_team AS player_nfl_team
     FROM roster_transactions rt
     LEFT JOIN users u ON u.id = rt.user_id
     LEFT JOIN teams t ON t.id = rt.team_id
     LEFT JOIN players p ON p.id = rt.player_id
     WHERE rt.league_id = $1
     ORDER BY rt.created_at DESC
     LIMIT $2`,
    [req.params.id, limit]
  );
  res.json(rows);
});

// =============================================
// POST /api/leagues/:id/simulate-week — score a week of matchups
// Commissioner only.
// For "real" leagues: uses player_stats. Falls back to mock if no stats.
// For "mock" leagues: always uses random scoring.
// Query: ?force=mock to override real leagues.
// =============================================
router.post('/:id/simulate-week', authenticate, requireCommissioner, async (req: AuthRequest, res: Response) => {
  try {
    const { rows: [league] } = await query('SELECT * FROM leagues WHERE id = $1', [req.params.id]);
    if (!league) { res.status(404).json({ error: 'League not found' }); return; }
    if (league.status !== 'in_season' && league.status !== 'post_season') {
      res.status(400).json({ error: 'League must be in_season or post_season to simulate' });
      return;
    }

    const week = league.week as number;
    const season = league.season as number;
    const forceMode = req.query.force as string | undefined;
    const leagueMode = league.scoring_source as string || 'mock';

    // Determine scoring mode: real leagues try real stats first
    let useReal = leagueMode === 'real' && forceMode !== 'mock';

    if (useReal) {
      // Check that stats exist for this week
      const { rows: [statsCheck] } = await query(
        `SELECT COUNT(*)::int AS cnt FROM player_stats WHERE season = $1 AND week = $2 AND season_type = 'regular'`,
        [season, week]
      );
      if ((statsCheck.cnt as number) === 0) {
        console.warn(`[scoring] No stats for ${season} week ${week} — falling back to mock`);
        useReal = false;
      }
    }

    // Lock lineups before scoring
    await query(
      'UPDATE leagues SET lineup_locked_week = GREATEST(lineup_locked_week, $2), updated_at = NOW() WHERE id = $1',
      [req.params.id, week]
    );

    // Get matchups for this week
    const { rows: matchups } = await query(
      `SELECT * FROM matchups WHERE league_id = $1 AND week = $2 AND is_complete = FALSE`,
      [req.params.id, week]
    );
    if (matchups.length === 0) {
      res.status(400).json({ error: `No unplayed matchups for week ${week}. Schedule may not be generated yet.` });
      return;
    }

    // Check how many teams have starters set
    const { rows: [starterCheck] } = await query(
      `SELECT COUNT(DISTINCT r.team_id)::int AS teams_with_starters
       FROM rosters r JOIN teams t ON t.id = r.team_id
       WHERE t.league_id = $1 AND r.is_starter = TRUE`,
      [req.params.id]
    );
    const teamsWithStarters = starterCheck.teams_with_starters as number;
    const { rows: [{ cnt: totalTeams }] } = await query(
      'SELECT COUNT(*)::int AS cnt FROM teams WHERE league_id = $1', [req.params.id]
    );
    const starterWarning = teamsWithStarters < (totalTeams as number)
      ? `Warning: ${(totalTeams as number) - teamsWithStarters} of ${totalTeams} teams have no starters set. Their scores are estimated.`
      : null;

    let scored = 0;
    const scoringSource = useReal ? 'real' : 'mock';

    if (useReal) {
      // Real scoring via scoringService
      const result = await scoreWeekReal(req.params.id as string, week);
      scored = result.scored;
    } else {
      // Mock scoring — random points
      for (const matchup of matchups) {
        const home = await calculateMockTeamScore(matchup.home_team_id);
        const away = await calculateMockTeamScore(matchup.away_team_id);

        let winnerId: string | null = null;
        if (home.total > away.total) winnerId = matchup.home_team_id;
        else if (away.total > home.total) winnerId = matchup.away_team_id;

        await query(
          `UPDATE matchups
           SET home_score = $1, away_score = $2, winner_team_id = $3, is_complete = TRUE,
               scoring_source = 'mock', updated_at = NOW()
           WHERE id = $4`,
          [home.total, away.total, winnerId, matchup.id]
        );

        // Persist per-player and team-level weekly scores
        await persistWeeklyScores(req.params.id as string, week, matchup.home_team_id, home.playerScores);
        await persistWeeklyScores(req.params.id as string, week, matchup.away_team_id, away.playerScores);

        // Update team records — only for regular season (not playoffs)
        if (!matchup.is_playoffs) {
          if (winnerId) {
            const loserId = winnerId === matchup.home_team_id ? matchup.away_team_id : matchup.home_team_id;
            await query('UPDATE teams SET wins = wins + 1, updated_at = NOW() WHERE id = $1', [winnerId]);
            await query('UPDATE teams SET losses = losses + 1, updated_at = NOW() WHERE id = $1', [loserId]);
          } else {
            await query('UPDATE teams SET ties = ties + 1, updated_at = NOW() WHERE id = $1', [matchup.home_team_id]);
            await query('UPDATE teams SET ties = ties + 1, updated_at = NOW() WHERE id = $1', [matchup.away_team_id]);
          }

          await query(
            'UPDATE teams SET points_for = points_for + $2, points_against = points_against + $3, updated_at = NOW() WHERE id = $1',
            [matchup.home_team_id, home.total, away.total]
          );
          await query(
            'UPDATE teams SET points_for = points_for + $2, points_against = points_against + $3, updated_at = NOW() WHERE id = $1',
            [matchup.away_team_id, away.total, home.total]
          );
        }

        scored++;
      }
    }

    // Advance league week and detect season transitions
    const nextWeek = week + 1;
    const leagueSettings = mergeWithDefaults(league.settings as Record<string, unknown>);
    const regularSeasonWeeks = leagueSettings.season.regular_season_weeks;
    const playoffTeams = leagueSettings.playoffs.teams;

    let newStatus = league.status as string;
    let seasonTransition: string | null = null;
    let playoffBracket: GeneratedBracket | null = null;
    let playoffAdvancement: AdvancementResult | null = null;

    // Transition: regular season just ended
    if (league.status === 'in_season' && week >= regularSeasonWeeks) {
      if (playoffTeams > 0) {
        newStatus = 'post_season';
        // Generate first-round playoff bracket from standings
        try {
          playoffBracket = await generateFirstRoundBracket(req.params.id as string, leagueSettings);
          const byeMsg = playoffBracket.byes.length > 0
            ? ` Seeds ${playoffBracket.byes.map(b => b.seed).join(', ')} have first-round byes.`
            : '';
          seasonTransition = `Regular season complete. ${playoffBracket.playoffTeams}-team playoffs begin week ${nextWeek}. ${playoffBracket.matchups.length} first-round matchups generated.${byeMsg}`;
        } catch (bracketErr) {
          console.error('[Playoffs] Bracket generation failed:', bracketErr);
          seasonTransition = 'Regular season complete. Playoffs begin. (Bracket generation failed — use generate-schedule to create playoff matchups manually.)';
        }
      } else {
        newStatus = 'complete';
        seasonTransition = 'Season complete. No playoffs configured.';
      }
    }

    // Playoff advancement: after scoring a playoff week, advance the bracket
    if (league.status === 'post_season') {
      try {
        // Check if this was the championship game
        const championCheck = await checkForChampion(req.params.id as string, week, leagueSettings);
        if (championCheck.isChampionship && championCheck.championTeamId) {
          newStatus = 'complete';
          seasonTransition = `Season complete! Champion determined.`;
          playoffAdvancement = {
            outcome: 'champion',
            championTeamId: championCheck.championTeamId,
            message: 'Champion determined!',
          };
        } else {
          // Try to advance to next round
          playoffAdvancement = await advancePlayoffRound(req.params.id as string, week, leagueSettings);
          if (playoffAdvancement.outcome === 'advanced') {
            seasonTransition = playoffAdvancement.message;
          }
        }
      } catch (advErr) {
        console.error('[Playoffs] Advancement failed:', advErr);
      }
    }

    await query(
      'UPDATE leagues SET week = $2, status = $3, updated_at = NOW() WHERE id = $1',
      [req.params.id, nextWeek, newStatus]
    );

    res.json({
      message: `Week ${week} scored (${scoringSource})${starterWarning ? '. ' + starterWarning : ''}`,
      week,
      scoring_source: scoringSource,
      warning: starterWarning,
      matchups_scored: scored,
      next_week: nextWeek,
      status: newStatus,
      season_transition: seasonTransition,
      playoff_bracket: playoffBracket,
      playoff_advancement: playoffAdvancement,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Scoring failed';
    res.status(500).json({ error: msg });
  }
});

// =============================================
// POST /api/leagues/:id/unlock-lineup — commissioner unlocks current week
// =============================================
router.post('/:id/unlock-lineup', authenticate, requireCommissioner, async (req: AuthRequest, res: Response) => {
  const { rows: [league] } = await query('SELECT id, week, lineup_locked_week FROM leagues WHERE id = $1', [req.params.id]);
  if (!league) { res.status(404).json({ error: 'League not found' }); return; }

  // Unlock by setting locked week to one less than current week
  const newLockedWeek = Math.max(0, (league.week as number) - 1);
  await query(
    'UPDATE leagues SET lineup_locked_week = $2, updated_at = NOW() WHERE id = $1',
    [req.params.id, newLockedWeek]
  );

  res.json({ message: `Lineups unlocked for week ${league.week}`, lineup_locked_week: newLockedWeek });
});

// =============================================
// GET /api/leagues/:id/settings — full settings object
// Members can read; returns merged-with-defaults settings.
// =============================================
router.get('/:id/settings', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const settings = await settingsService.getSettings(req.params.id as string);
    res.json(settings);
  } catch (err: unknown) {
    const status = (err as { status?: number }).status || 500;
    res.status(status).json({ error: (err as Error).message });
  }
});

// =============================================
// PATCH /api/leagues/:id/settings/:section — update a settings section
// Commissioner only. Most sections locked after draft starts.
// =============================================
router.patch('/:id/settings/:section', authenticate, requireCommissioner, async (req: AuthRequest, res: Response) => {
  const validSections = ['roster', 'scoring', 'draft', 'trades', 'waivers', 'season', 'playoffs'] as const;
  const section = req.params.section as typeof validSections[number];

  if (!validSections.includes(section)) {
    res.status(400).json({ error: `Invalid settings section: ${section}` });
    return;
  }

  try {
    const result = await settingsService.updateSection(req.params.id as string, section, req.body);
    res.json(result);
  } catch (err: unknown) {
    const status = (err as { status?: number }).status || 500;
    const details = (err as { details?: unknown }).details;
    res.status(status).json({ error: (err as Error).message, ...(details ? { details } : {}) });
  }
});

// =============================================
// PATCH /api/leagues/:id/roster-settings — update roster config (backward compat)
// Commissioner only, pre-draft only.
// =============================================
router.patch('/:id/roster-settings', authenticate, requireCommissioner, async (req: AuthRequest, res: Response) => {
  try {
    const result = await settingsService.updateRosterSettings(req.params.id as string, req.body);
    res.json(result);
  } catch (err: unknown) {
    const status = (err as { status?: number }).status || 500;
    const details = (err as { details?: unknown }).details;
    res.status(status).json({ error: (err as Error).message, ...(details ? { details } : {}) });
  }
});

/**
 * Calculate a mock team score by giving each starter a random score.
 * Returns per-player scores for persistence.
 */
async function calculateMockTeamScore(teamId: string): Promise<{ total: number; playerScores: PlayerScore[] }> {
  const { rows: starters } = await query(
    `SELECT r.player_id, r.roster_slot, p.position
     FROM rosters r
     JOIN players p ON p.id = r.player_id
     WHERE r.team_id = $1 AND r.is_starter = TRUE`,
    [teamId]
  );

  if (starters.length === 0) {
    const fallbackTotal = Math.round((60 + Math.random() * 80) * 100) / 100;
    return { total: fallbackTotal, playerScores: [] };
  }

  const playerScores: PlayerScore[] = [];
  let total = 0;

  for (const starter of starters) {
    const base = starter.position === 'QB' ? 12 : starter.position === 'K' ? 4 : 5;
    const range = starter.position === 'QB' ? 18 : starter.position === 'K' ? 12 : 20;
    const points = Math.round((base + Math.random() * range) * 100) / 100;
    total += points;

    playerScores.push({
      playerId: starter.player_id,
      points,
      isStarter: true,
      statBreakdown: { mock: points },
    });
  }

  return { total: Math.round(total * 100) / 100, playerScores };
}

// =============================================
// PATCH /api/leagues/:id — commissioner updates week or status
// =============================================
router.patch('/:id', authenticate, requireCommissioner, async (req: AuthRequest, res: Response) => {
  const Schema = z.object({
    name:    z.string().min(1).max(100).optional(),
    season:  z.number().int().min(2020).max(2035).optional(),
    week:    z.number().int().min(1).max(22).optional(),
    status:  z.enum(['pre_draft', 'drafting', 'in_season', 'post_season', 'complete']).optional(),
  });

  const body = Schema.parse(req.body);

  // Enforce valid state transitions — no backwards moves
  if (body.status !== undefined) {
    const { rows: [league] } = await query('SELECT status FROM leagues WHERE id = $1', [req.params.id]);
    if (!league) { res.status(404).json({ error: 'League not found' }); return; }

    const STATE_ORDER: Record<string, number> = {
      pre_draft: 0, drafting: 1, in_season: 2, post_season: 3, complete: 4,
    };
    const currentRank = STATE_ORDER[league.status as string] ?? 0;
    const targetRank = STATE_ORDER[body.status] ?? 0;

    if (targetRank < currentRank) {
      res.status(400).json({
        error: `Cannot transition from ${league.status} to ${body.status}. Status can only move forward.`,
      });
      return;
    }
  }

  const sets: string[] = [];
  const params: unknown[] = [];

  if (body.name !== undefined)   { sets.push(`name = $${params.length + 1}`);   params.push(body.name); }
  if (body.season !== undefined) { sets.push(`season = $${params.length + 1}`); params.push(body.season); }
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
       hu.display_name as home_owner, au.display_name as away_owner,
       hp.full_name as home_top_scorer_name, hws.total_points as home_top_scorer_pts,
       ap.full_name as away_top_scorer_name, aws.total_points as away_top_scorer_pts
     FROM matchups m
     JOIN teams ht ON ht.id = m.home_team_id
     JOIN teams at ON at.id = m.away_team_id
     LEFT JOIN users hu ON hu.id = ht.user_id
     LEFT JOIN users au ON au.id = at.user_id
     LEFT JOIN weekly_scores hws ON hws.team_id = m.home_team_id AND hws.week = m.week
     LEFT JOIN weekly_scores aws ON aws.team_id = m.away_team_id AND aws.week = m.week
     LEFT JOIN players hp ON hp.id = hws.highest_scorer_id
     LEFT JOIN players ap ON ap.id = aws.highest_scorer_id
     WHERE m.league_id = $1 AND m.week = $2
     ORDER BY m.home_score DESC`,
    [req.params.id, week]
  );
  res.json(rows);
});

// =============================================
// GET /api/leagues/:id/matchups/:matchupId/scores
// Returns matchup with per-player score breakdowns from player_weekly_scores.
// =============================================
router.get('/:id/matchups/:matchupId/scores', authenticate, async (req: AuthRequest, res: Response) => {
  const leagueId = req.params.id as string;
  const matchupId = req.params.matchupId as string;

  // Fetch matchup
  const { rows: [matchup] } = await query(
    `SELECT m.*,
       ht.name as home_team_name, at.name as away_team_name,
       hu.display_name as home_owner, au.display_name as away_owner
     FROM matchups m
     JOIN teams ht ON ht.id = m.home_team_id
     JOIN teams at ON at.id = m.away_team_id
     LEFT JOIN users hu ON hu.id = ht.user_id
     LEFT JOIN users au ON au.id = at.user_id
     WHERE m.id = $1 AND m.league_id = $2`,
    [matchupId, leagueId]
  );
  if (!matchup) { res.status(404).json({ error: 'Matchup not found' }); return; }

  // Fetch per-player scores for both teams
  const week = matchup.week as number;
  const homeScores = await getTeamWeeklyScore(leagueId, week, matchup.home_team_id);
  const awayScores = await getTeamWeeklyScore(leagueId, week, matchup.away_team_id);

  res.json({
    matchup,
    home: homeScores,
    away: awayScores,
  });
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

      // Check if this matchup was already finalized so we don't double-count stats
      const { rows: [existing] } = await query(
        `SELECT is_complete FROM matchups
         WHERE league_id = $1 AND week = $2
           AND home_team_id = $3 AND away_team_id = $4`,
        [league.id, week, homeTeam.id, awayTeam.id]
      );
      const alreadyComplete = existing?.is_complete === true;

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

      // Only update team stats on first completion — prevents double-counting on re-import
      if (!alreadyComplete) {
        if (winnerId) {
          const loserId = winnerId === homeTeam.id ? awayTeam.id : homeTeam.id;
          await query(`UPDATE teams SET wins   = wins   + 1, updated_at = NOW() WHERE id = $1`, [winnerId]);
          await query(`UPDATE teams SET losses = losses + 1, updated_at = NOW() WHERE id = $1`, [loserId]);
        }
        await query(
          `UPDATE teams SET points_for     = points_for     + $2,
                            points_against = points_against + $3,
                            updated_at     = NOW()
           WHERE id = $1`,
          [homeTeam.id, homeScore, awayScore]
        );
        await query(
          `UPDATE teams SET points_for     = points_for     + $2,
                            points_against = points_against + $3,
                            updated_at     = NOW()
           WHERE id = $1`,
          [awayTeam.id, awayScore, homeScore]
        );
      }

      imported++;
    }

    res.json({ message: `Imported ${imported} matchups for week ${week}`, week, imported });

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Import failed';
    res.status(502).json({ error: `Matchup import failed: ${msg}` });
  }
});

// =============================================
// POST /api/leagues/:id/generate-schedule — commissioner only
// Creates a round-robin matchup schedule for native (non-Sleeper) leagues.
// Query param: ?weeks=N overrides the default from settings.season.regular_season_weeks.
// Idempotent: skips weeks that already have matchups.
// =============================================
router.post('/:id/generate-schedule', authenticate, requireCommissioner, async (req: AuthRequest, res: Response) => {
  try {
    const { rows: [league] } = await query('SELECT * FROM leagues WHERE id = $1', [req.params.id]);
    if (!league) { res.status(404).json({ error: 'League not found' }); return; }

    const { rows: teams } = await query(
      'SELECT id FROM teams WHERE league_id = $1 ORDER BY created_at',
      [req.params.id]
    );
    if (teams.length < 2) {
      res.status(400).json({ error: 'Need at least 2 teams to generate a schedule' });
      return;
    }

    // Default season length from settings; ?weeks=N overrides
    const leagueSettings = mergeWithDefaults(league.settings as Record<string, unknown>);
    const defaultWeeks = leagueSettings.season.regular_season_weeks;
    const totalWeeks = Math.min(parseInt(req.query.weeks as string || String(defaultWeeks), 10), 18);
    const ids: string[] = teams.map((t: { id: string }) => t.id);

    // Standard round-robin (circle method). If odd number of teams, add a bye.
    const hasBye = ids.length % 2 !== 0;
    if (hasBye) ids.push('bye');
    const n = ids.length; // always even

    let created = 0;
    let skipped = 0;

    for (let week = 1; week <= totalWeeks; week++) {
      // Check if this week already has matchups
      const { rows: existing } = await query(
        'SELECT id FROM matchups WHERE league_id = $1 AND week = $2 LIMIT 1',
        [req.params.id, week]
      );
      if (existing.length > 0) { skipped++; continue; }

      // Rotate: pin ids[0], rotate rest by (week-1)
      const rotated = [ids[0]];
      for (let i = 1; i < n; i++) {
        rotated.push(ids[1 + ((i - 1 + week - 1) % (n - 1))]);
      }

      const isPlayoffWeek = week > defaultWeeks;
      for (let i = 0; i < n / 2; i++) {
        const home = rotated[i];
        const away = rotated[n - 1 - i];
        if (home === 'bye' || away === 'bye') continue;

        await query(
          `INSERT INTO matchups (league_id, week, home_team_id, away_team_id, is_playoffs)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT DO NOTHING`,
          [req.params.id, week, home, away, isPlayoffWeek]
        );
        created++;
      }
    }

    res.json({ message: 'Schedule generated', weeks: totalWeeks, matchups_created: created, weeks_skipped: skipped });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Schedule generation failed';
    res.status(500).json({ error: msg });
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
