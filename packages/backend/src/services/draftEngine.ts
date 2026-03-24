import { Server } from 'socket.io';
import { query } from '../config/database';

// =============================================
// Shared Types
// =============================================

export interface DraftSession {
  id: string;
  league_id: string;
  status: 'pending' | 'active' | 'paused' | 'complete';
  total_rounds: number;
  seconds_per_pick: number;
  current_pick: number;
  draft_order: string[];   // team UUIDs in round-1 order
  started_at: string | null;
  paused_at: string | null;
  completed_at: string | null;
}

export interface DraftTeam {
  id: string;
  name: string;
  user_id: string;
  display_name?: string;
  avatar_url?: string;
}

export interface DraftPickRow {
  id: string;
  session_id: string;
  league_id: string;
  team_id: string;
  player_id: string;
  overall_pick: number;
  round: number;
  pick_in_round: number;
  is_auto_pick: boolean;
  picked_at: string;
  // Joined fields
  player_name: string;
  position: string;
  nfl_team: string;
  team_name: string;
}

export interface DraftState {
  session: DraftSession;
  teams: DraftTeam[];
  picks: DraftPickRow[];
  currentTeamId: string | null;
  secondsRemaining: number;
  round: number;
  pickInRound: number;
}

// =============================================
// Snake order helper
// =============================================

/**
 * Given a 1-indexed overall pick number and the number of teams,
 * returns the round (1-indexed), pick-in-round (1-indexed), and
 * the 0-indexed position into the draft_order array for snake order.
 *
 * Odd rounds go left→right; even rounds go right→left.
 */
export function getPickPosition(overallPick: number, numTeams: number) {
  if (numTeams === 0) return { round: 1, pickInRound: 1, teamIndex: 0 };
  const round        = Math.ceil(overallPick / numTeams);
  const pickInRound  = ((overallPick - 1) % numTeams) + 1; // 1-indexed
  const teamIndex    = round % 2 === 1
    ? pickInRound - 1         // odd round: forward (0..N-1)
    : numTeams - pickInRound; // even round: reversed (N-1..0)
  return { round, pickInRound, teamIndex };
}

// =============================================
// DraftEngine
// =============================================

export class DraftEngine {
  private readonly sessionId: string;
  private readonly io: Server;
  private timer: NodeJS.Timeout | null = null;

  /** Seconds left on the clock — accessible to socketServer for new joiners. */
  secondsRemaining = 90;

  constructor(sessionId: string, io: Server) {
    this.sessionId = sessionId;
    this.io = io;
  }

  get room(): string {
    return `draft:${this.sessionId}`;
  }

  // ── DB helpers ─────────────────────────────────────────────────────────

  async getSession(): Promise<DraftSession> {
    const { rows: [row] } = await query(
      'SELECT * FROM draft_sessions WHERE id = $1',
      [this.sessionId]
    );
    if (!row) throw new Error('Draft session not found');
    return row as DraftSession;
  }

  async getTeams(): Promise<DraftTeam[]> {
    const session = await this.getSession();
    const { rows } = await query(
      `SELECT t.id, t.name, t.user_id, u.display_name, u.avatar_url
       FROM   teams t
       LEFT JOIN users u ON u.id = t.user_id
       WHERE  t.league_id = $1
       ORDER  BY t.name`,
      [session.league_id]
    );
    return rows as DraftTeam[];
  }

  async getPicks(): Promise<DraftPickRow[]> {
    const { rows } = await query(
      `SELECT dp.*,
              p.full_name AS player_name, p.position, p.nfl_team,
              t.name      AS team_name
       FROM   draft_picks dp
       JOIN   players p ON p.id = dp.player_id
       JOIN   teams   t ON t.id = dp.team_id
       WHERE  dp.session_id = $1
       ORDER  BY dp.overall_pick ASC`,
      [this.sessionId]
    );
    return rows as DraftPickRow[];
  }

  async getState(): Promise<DraftState> {
    const [session, teams, picks] = await Promise.all([
      this.getSession(),
      this.getTeams(),
      this.getPicks(),
    ]);

    const totalPicks = session.total_rounds * (session.draft_order.length || 1);
    const isDone = session.status === 'complete' || session.current_pick > totalPicks;

    let currentTeamId: string | null = null;
    let round = 1;
    let pickInRound = 1;

    if (!isDone && session.draft_order.length > 0) {
      const pos = getPickPosition(session.current_pick, session.draft_order.length);
      round         = pos.round;
      pickInRound   = pos.pickInRound;
      currentTeamId = session.draft_order[pos.teamIndex] ?? null;
    }

    return {
      session,
      teams,
      picks,
      currentTeamId,
      secondsRemaining: this.secondsRemaining,
      round,
      pickInRound,
    };
  }

  // ── Draft control ───────────────────────────────────────────────────────

  async start(): Promise<void> {
    const session = await this.getSession();
    if (session.status !== 'pending') {
      throw new Error(`Cannot start draft in status: ${session.status}`);
    }

    await query(
      `UPDATE draft_sessions
       SET status = 'active', started_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [this.sessionId]
    );

    this.secondsRemaining = session.seconds_per_pick;
    this.startTimer();

    const state = await this.getState();
    this.io.to(this.room).emit('draft:started', state);
    console.log(`[DraftEngine] Started session ${this.sessionId}`);
  }

  async pause(pausedBy: string): Promise<void> {
    this.stopTimer();
    await query(
      `UPDATE draft_sessions
       SET status = 'paused', paused_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [this.sessionId]
    );
    this.io.to(this.room).emit('draft:paused', { paused_by: pausedBy });
    console.log(`[DraftEngine] Paused session ${this.sessionId} by ${pausedBy}`);
  }

  async resume(): Promise<void> {
    const session = await this.getSession();
    if (session.status !== 'paused') {
      throw new Error(`Cannot resume draft in status: ${session.status}`);
    }

    await query(
      `UPDATE draft_sessions
       SET status = 'active', paused_at = NULL, updated_at = NOW()
       WHERE id = $1`,
      [this.sessionId]
    );

    this.secondsRemaining = session.seconds_per_pick;
    this.startTimer();
    this.io.to(this.room).emit('draft:resumed', { seconds_remaining: this.secondsRemaining });
    console.log(`[DraftEngine] Resumed session ${this.sessionId}`);
  }

  // ── Pick logic ──────────────────────────────────────────────────────────

  async makePick(teamId: string, playerId: string, isAutoPick: boolean): Promise<DraftPickRow> {
    const session = await this.getSession();

    if (session.status !== 'active') {
      throw new Error(`Draft is not active (status: ${session.status})`);
    }

    // Verify it's this team's turn
    const { round, pickInRound, teamIndex } = getPickPosition(
      session.current_pick, session.draft_order.length
    );
    const expectedTeamId = session.draft_order[teamIndex];
    if (teamId !== expectedTeamId) {
      throw new Error('It is not your turn to pick');
    }

    // Insert pick — UNIQUE(session_id, overall_pick) prevents concurrent double-picks
    const { rows: [pick] } = await query(
      `INSERT INTO draft_picks
         (session_id, league_id, team_id, player_id,
          overall_pick, round, pick_in_round, is_auto_pick)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        this.sessionId, session.league_id, teamId, playerId,
        session.current_pick, round, pickInRound, isAutoPick,
      ]
    );

    // Persist to team roster
    await query(
      `INSERT INTO rosters (team_id, player_id, acquisition_type, acquisition_week, is_starter)
       SELECT $1, $2, 'draft', $3, false
       WHERE  EXISTS (SELECT 1 FROM players WHERE id = $2)
       ON CONFLICT (team_id, player_id) DO NOTHING`,
      [teamId, playerId, round]
    );

    // Advance the pick counter
    const nextPick   = session.current_pick + 1;
    const totalPicks = session.total_rounds * session.draft_order.length;
    const isComplete = nextPick > totalPicks;

    await query(
      `UPDATE draft_sessions
       SET current_pick = $1,
           status       = $2,
           ${isComplete ? 'completed_at = NOW(),' : ''}
           updated_at   = NOW()
       WHERE id = $3`,
      [nextPick, isComplete ? 'complete' : 'active', this.sessionId]
    );

    // Build enriched pick row for broadcast
    const { rows: [enriched] } = await query(
      `SELECT dp.*,
              p.full_name AS player_name, p.position, p.nfl_team,
              t.name      AS team_name
       FROM   draft_picks dp
       JOIN   players p ON p.id = dp.player_id
       JOIN   teams   t ON t.id = dp.team_id
       WHERE  dp.id = $1`,
      [pick.id]
    );

    // Compute next state
    this.stopTimer();

    let nextTeamId: string | null = null;
    let nextRound = round;
    let nextPickInRound = pickInRound;

    if (!isComplete) {
      const nextPos = getPickPosition(nextPick, session.draft_order.length);
      nextTeamId     = session.draft_order[nextPos.teamIndex] ?? null;
      nextRound      = nextPos.round;
      nextPickInRound = nextPos.pickInRound;
    }

    this.io.to(this.room).emit('draft:pick', {
      pick: enriched,
      nextTeamId,
      nextRound,
      nextPickInRound,
      secondsRemaining: session.seconds_per_pick,
    });

    if (isComplete) {
      this.io.to(this.room).emit('draft:complete', { session_id: this.sessionId });
      console.log(`[DraftEngine] Session ${this.sessionId} complete`);
    } else {
      this.secondsRemaining = session.seconds_per_pick;
      this.startTimer();
    }

    return enriched as DraftPickRow;
  }

  /** Auto-pick the highest-PPR available player. Falls back to any available if no stats. */
  async autoPick(): Promise<void> {
    const session = await this.getSession();
    if (session.status !== 'active') return;

    const { teamIndex } = getPickPosition(session.current_pick, session.draft_order.length);
    const teamId = session.draft_order[teamIndex];
    if (!teamId) return;

    const { rows: [player] } = await query(
      `SELECT p.id
       FROM   players p
       LEFT JOIN (
         SELECT player_id, MAX(fantasy_pts_ppr) AS best_ppr
         FROM   player_stats
         GROUP  BY player_id
       ) ps ON ps.player_id = p.id
       WHERE  p.id NOT IN (
         SELECT player_id FROM draft_picks WHERE session_id = $1
       )
       ORDER  BY COALESCE(ps.best_ppr, 0) DESC, p.full_name
       LIMIT  1`,
      [this.sessionId]
    );

    if (!player) {
      console.warn(`[DraftEngine] No available players for auto-pick in ${this.sessionId}`);
      return;
    }

    console.log(`[DraftEngine] Auto-picking ${player.id} for team ${teamId}`);
    await this.makePick(teamId, player.id, true).catch((err) => {
      console.error('[DraftEngine] makePick in autoPick failed:', err);
    });
  }

  // ── Timer ───────────────────────────────────────────────────────────────

  private startTimer(): void {
    this.stopTimer();
    this.timer = setInterval(() => {
      this.secondsRemaining = Math.max(0, this.secondsRemaining - 1);
      this.io.to(this.room).emit('draft:tick', { seconds_remaining: this.secondsRemaining });

      if (this.secondsRemaining <= 0) {
        this.stopTimer();
        this.autoPick().catch((err) => {
          console.error('[DraftEngine] Auto-pick on timer expiry failed:', err);
        });
      }
    }, 1000);
  }

  private stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Call when removing the engine from the active-sessions map. */
  destroy(): void {
    this.stopTimer();
  }
}
