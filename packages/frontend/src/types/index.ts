// =============================================
// The No Fun League — Shared Types
// =============================================

export interface User {
  id: string;
  username: string;
  email: string;
  display_name: string;
  avatar_url?: string;
  sleeper_user_id?: string;
  trash_talk_style: 'aggressive' | 'petty' | 'poetic' | 'silent';
  created_at: string;
}

// =============================================
// Roster Settings
// =============================================

export type FlexType = 'RB_WR' | 'RB_WR_TE' | 'QB_RB_WR_TE';

export interface RosterSettings {
  qb_slots: number;
  rb_slots: number;
  wr_slots: number;
  te_slots: number;
  flex_slots: number;
  flex_types: FlexType;
  superflex_slots: number;
  k_slots: number;
  def_slots: number;
  bench_slots: number;
  ir_slots: number;
  max_qb: number;
  max_rb: number;
  max_wr: number;
  max_te: number;
  max_k: number;
  max_def: number;
}

export const DEFAULT_ROSTER_SETTINGS: RosterSettings = {
  qb_slots: 1, rb_slots: 2, wr_slots: 2, te_slots: 1,
  flex_slots: 1, flex_types: 'RB_WR_TE', superflex_slots: 0,
  k_slots: 0, def_slots: 0, bench_slots: 6, ir_slots: 0,
  max_qb: 0, max_rb: 0, max_wr: 0, max_te: 0, max_k: 0, max_def: 0,
};

// =============================================
// Full League Settings (matches backend canonical model)
// =============================================

export interface ScoringSettings {
  type: 'standard' | 'half_ppr' | 'ppr' | 'custom';
  source: 'mock' | 'real';
  // Per-stat scoring values
  pass_yd: number; pass_td: number; pass_int: number; pass_2pt: number;
  rush_yd: number; rush_td: number; rush_2pt: number;
  rec: number; rec_yd: number; rec_td: number; rec_2pt: number;
  fum_lost: number;
  fg_0_19: number; fg_20_29: number; fg_30_39: number; fg_40_49: number; fg_50p: number;
  xpt: number; xpt_miss: number;
  def_sack: number; def_int: number; def_fum_rec: number;
  def_td: number; def_st_td: number; def_safe: number; def_blk_kick: number;
  def_pts_allow_0: number; def_pts_allow_1_6: number; def_pts_allow_7_13: number;
  def_pts_allow_14_20: number; def_pts_allow_21_27: number; def_pts_allow_28_34: number; def_pts_allow_35p: number;
}

export interface DraftSettings {
  type: 'snake' | 'linear';
  seconds_per_pick: number;
  auto_pick_on_timeout: boolean;
}

export interface TradeSettings {
  approval_type: 'commissioner' | 'league_vote' | 'none';
  review_period_hours: number;
  trade_deadline_week: number;
  votes_to_veto: number;
  allow_draft_pick_trades: boolean;
}

export interface WaiverSettings {
  type: 'standard' | 'faab' | 'none';
  waiver_period_days: number;
  faab_budget: number;
  process_day: 'tuesday' | 'wednesday' | 'daily';
}

export interface SeasonSettings {
  regular_season_weeks: number;
  playoff_start_week: number;
  schedule_type: 'round_robin' | 'random';
}

export interface PlayoffSettings {
  teams: number;
  weeks_per_round: 1 | 2;
  reseed: boolean;
  consolation_bracket: boolean;
}

export interface LeagueSettings {
  roster: RosterSettings;
  scoring: ScoringSettings;
  draft: DraftSettings;
  trades: TradeSettings;
  waivers: WaiverSettings;
  season: SeasonSettings;
  playoffs: PlayoffSettings;
}

export const DEFAULT_LEAGUE_SETTINGS: LeagueSettings = {
  roster: { ...DEFAULT_ROSTER_SETTINGS },
  scoring: {
    type: 'half_ppr', source: 'mock',
    pass_yd: 0.04, pass_td: 4, pass_int: -2, pass_2pt: 2,
    rush_yd: 0.1, rush_td: 6, rush_2pt: 2,
    rec: 0.5, rec_yd: 0.1, rec_td: 6, rec_2pt: 2,
    fum_lost: -2,
    fg_0_19: 3, fg_20_29: 3, fg_30_39: 3, fg_40_49: 4, fg_50p: 5,
    xpt: 1, xpt_miss: -1,
    def_sack: 1, def_int: 2, def_fum_rec: 2, def_td: 6, def_st_td: 6, def_safe: 2, def_blk_kick: 2,
    def_pts_allow_0: 10, def_pts_allow_1_6: 7, def_pts_allow_7_13: 4,
    def_pts_allow_14_20: 1, def_pts_allow_21_27: 0, def_pts_allow_28_34: -1, def_pts_allow_35p: -4,
  },
  draft: { type: 'snake', seconds_per_pick: 90, auto_pick_on_timeout: true },
  trades: { approval_type: 'commissioner', review_period_hours: 24, trade_deadline_week: 0, votes_to_veto: 4, allow_draft_pick_trades: false },
  waivers: { type: 'standard', waiver_period_days: 2, faab_budget: 100, process_day: 'wednesday' },
  season: { regular_season_weeks: 14, playoff_start_week: 15, schedule_type: 'round_robin' },
  playoffs: { teams: 4, weeks_per_round: 1, reseed: false, consolation_bracket: false },
};

export function getRosterFromSettings(settings: Record<string, unknown>): RosterSettings {
  const r = settings?.roster as Partial<RosterSettings> | undefined;
  if (!r) return { ...DEFAULT_ROSTER_SETTINGS };
  return { ...DEFAULT_ROSTER_SETTINGS, ...r };
}

export function getLeagueSettings(settings: Record<string, unknown>): LeagueSettings {
  if (!settings) return { ...DEFAULT_LEAGUE_SETTINGS };
  function merge<T>(def: T, raw: unknown): T {
    if (!raw || typeof raw !== 'object') return { ...def };
    const result: Record<string, unknown> = { ...(def as Record<string, unknown>) };
    for (const key of Object.keys(result)) {
      const val = (raw as Record<string, unknown>)[key];
      if (val !== undefined && val !== null) result[key] = val;
    }
    return result as T;
  }
  return {
    roster:   merge<RosterSettings>(DEFAULT_ROSTER_SETTINGS, settings.roster),
    scoring:  merge<ScoringSettings>(DEFAULT_LEAGUE_SETTINGS.scoring, settings.scoring),
    draft:    merge<DraftSettings>(DEFAULT_LEAGUE_SETTINGS.draft, settings.draft),
    trades:   merge<TradeSettings>(DEFAULT_LEAGUE_SETTINGS.trades, settings.trades),
    waivers:  merge<WaiverSettings>(DEFAULT_LEAGUE_SETTINGS.waivers, settings.waivers),
    season:   merge<SeasonSettings>(DEFAULT_LEAGUE_SETTINGS.season, settings.season),
    playoffs: merge<PlayoffSettings>(DEFAULT_LEAGUE_SETTINGS.playoffs, settings.playoffs),
  };
}

export function totalRosterSize(r: RosterSettings): number {
  return r.qb_slots + r.rb_slots + r.wr_slots + r.te_slots
    + r.flex_slots + (r.superflex_slots || 0) + r.k_slots + r.def_slots
    + r.bench_slots + (r.ir_slots || 0);
}

export function starterCount(r: RosterSettings): number {
  return r.qb_slots + r.rb_slots + r.wr_slots + r.te_slots
    + r.flex_slots + (r.superflex_slots || 0) + r.k_slots + r.def_slots;
}

export function draftRounds(r: RosterSettings): number {
  return starterCount(r) + r.bench_slots;
}

/** Safe format: league status for display. Never crashes on undefined. */
export function formatStatus(status?: string | null): string {
  if (!status) return 'Unknown';
  return status.replace(/_/g, ' ');
}

/** Safe format: scoring type for display. */
export function formatScoringType(type?: string | null): string {
  if (!type) return 'Standard';
  return type.replace(/_/g, ' ').toUpperCase();
}

export interface League {
  id: string;
  name: string;
  sleeper_league_id?: string;
  commissioner_id: string;
  season: number;
  week: number;
  status: 'pre_draft' | 'drafting' | 'in_season' | 'post_season' | 'complete';
  settings: Record<string, unknown>;
  ai_enabled: boolean;
  chaos_mode: boolean;
  league_size: number;
  scoring_type: 'standard' | 'half_ppr' | 'ppr';
  invite_code?: string;
  lineup_locked_week: number;
  scoring_source: 'mock' | 'real';
  created_at: string;
  teams?: Team[];
  team_name?: string;
}

export interface Team {
  id: string;
  league_id: string;
  user_id: string;
  name: string;
  sleeper_roster_id?: number;
  wins: number;
  losses: number;
  ties: number;
  points_for: number;
  points_against: number;
  waiver_priority?: number;
  faab_balance: number;
  display_name?: string;
  avatar_url?: string;
  trash_talk_style?: string;
  roster?: RosterPlayer[];
}

export interface Player {
  id: string;
  full_name: string;
  first_name: string;
  last_name: string;
  position: 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DEF';
  nfl_team: string;
  jersey_number?: number;
  status: string;
  injury_status?: string;
  age?: number;
  years_exp?: number;
  college?: string;
  fantasy_positions: string[];
}

export interface RosterPlayer extends Player {
  roster_slot: string | null;
  is_starter: boolean;
  acquisition_type: string;
}

export interface AvailablePlayer {
  id: string;
  full_name: string;
  position: string;
  nfl_team: string;
  status: string;
  injury_status?: string;
}

export interface Matchup {
  id: string;
  league_id: string;
  week: number;
  home_team_id: string;
  away_team_id: string;
  home_score: number;
  away_score: number;
  winner_team_id?: string;
  is_playoffs: boolean;
  is_complete: boolean;
  scoring_source?: 'mock' | 'real' | null;
  home_team_name?: string;
  away_team_name?: string;
  home_owner?: string;
  away_owner?: string;
}

export interface WeeklyScore {
  id: string;
  team_id: string;
  league_id: string;
  week: number;
  total_points: number;
  projected_points: number;
  player_scores: Array<{
    player_id: string;
    points: number;
    projected: number;
    is_starter: boolean;
  }>;
  highest_scorer_name?: string;
  biggest_bust_name?: string;
}

export interface ChatMessage {
  id: string;
  league_id: string;
  user_id?: string;
  is_ai: boolean;
  ai_target_team_id?: string;
  message: string;
  message_type: 'chat' | 'trash_talk' | 'weekly_recap' | 'system';
  week?: number;
  display_name?: string;
  avatar_url?: string;
  target_team_name?: string;
  created_at: string;
}

export interface TradeItem {
  id: string;
  trade_id: string;
  player_id: string;
  player_name: string;
  position: string;
  nfl_team: string;
  from_team_id: string;
  from_team_name: string;
  to_team_id: string;
  to_team_name: string;
}

export interface Trade {
  id: string;
  league_id: string;
  proposing_team_id: string;
  proposing_team_name: string;
  proposing_owner?: string;
  receiving_team_id: string;
  receiving_team_name: string;
  receiving_owner?: string;
  status: 'pending' | 'accepted' | 'rejected' | 'approved' | 'vetoed';
  proposer_note?: string;
  response_note?: string;
  commissioner_note?: string;
  proposed_at: string;
  responded_at?: string;
  decided_at?: string;
  items: TradeItem[];
}

// =============================================
// Invites
// =============================================

export interface LeagueInvite {
  id: string;
  league_id: string;
  code: string;
  created_by: string;
  max_uses: number | null;
  uses: number;
  expires_at: string | null;
  is_active: boolean;
  created_at: string;
  // Preview fields (joined)
  league_name?: string;
  season?: number;
  week?: number;
  league_status?: string;
  commissioner_name?: string;
  team_count?: number;
  max_teams?: number;
  already_member?: boolean;
}

// =============================================
// Draft
// =============================================

export interface DraftSession {
  id: string;
  league_id: string;
  status: 'pending' | 'active' | 'paused' | 'complete';
  total_rounds: number;
  seconds_per_pick: number;
  current_pick: number;
  draft_order: string[];
  started_at: string | null;
  paused_at: string | null;
  completed_at: string | null;
  pick_started_at: string | null;
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

export interface DraftAvailablePlayer {
  id: string;
  full_name: string;
  position: string;
  nfl_team: string;
  injury_status?: string;
  status: string;
  avg_ppr: number;
}

export interface ApiResponse<T> {
  data?: T;
  error?: string;
}

export interface LeagueMember {
  id: string;
  role: 'commissioner' | 'member';
  created_at: string;
  user_id: string;
  username: string;
  display_name: string;
  avatar_url?: string;
}

export interface Transaction {
  id: string;
  type: 'add' | 'drop' | 'move';
  detail: string | null;
  created_at: string;
  user_name: string;
  username: string;
  team_name: string;
  player_name: string;
  player_position: string;
  player_nfl_team: string;
}

export interface WaiverClaim {
  id: string;
  league_id: string;
  team_id: string;
  player_id: string;
  week: number;
  status: 'pending' | 'approved' | 'rejected';
  processed_at: string | null;
  created_at: string;
  team_name?: string;
  user_name?: string;
  player_name?: string;
  player_position?: string;
  player_nfl_team?: string;
  waiver_priority?: number;
}

export type TrashTalkStyle = 'aggressive' | 'petty' | 'poetic' | 'silent';
