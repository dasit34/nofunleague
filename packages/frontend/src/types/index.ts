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
  created_at: string;
  teams?: Team[];
  team_name?: string; // current user's team name
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
  roster_slot: string;
  is_starter: boolean;
  acquisition_type: string;
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

export type TrashTalkStyle = 'aggressive' | 'petty' | 'poetic' | 'silent';
