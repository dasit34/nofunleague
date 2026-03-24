import type { User, Trade } from '@/types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('nfl_token');
}

// Called by the 401 handler — imported lazily to avoid circular deps with store
function handleUnauthenticated() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('nfl_token');
  localStorage.removeItem('nfl-auth'); // zustand persist key
  window.location.href = '/login?session=expired';
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (res.status === 401) {
    const body = await res.json().catch(() => ({ code: '' }));
    // Only auto-logout on token problems, not wrong password attempts
    if (body.code === 'TOKEN_EXPIRED' || body.code === 'INVALID_TOKEN' || body.code === 'NO_TOKEN') {
      handleUnauthenticated();
      throw new Error('Session expired. Please sign in again.');
    }
    throw new Error(body.error || 'Unauthorized');
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  return res.json();
}

// =============================================
// Auth
// =============================================
export const auth = {
  register: (data: {
    username: string;
    email: string;
    password: string;
    display_name?: string;
    trash_talk_style?: string;
  }) =>
    request<{ user: User; token: string; expires_in: number }>('/api/users/register', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  login: (data: { email: string; password: string }) =>
    request<{ user: User; token: string; expires_in: number }>('/api/users/login', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  logout: () =>
    request<{ message: string }>('/api/users/logout', { method: 'POST' }),

  me: () => request<User>('/api/users/me'),

  stats: () => request<{
    leagues_count: number;
    total_wins: number;
    total_losses: number;
    total_ties: number;
    total_points_for: number;
    pending_trades: number;
  }>('/api/users/me/stats'),

  updateProfile: (data: {
    display_name?: string;
    avatar_url?: string | null;
    sleeper_user_id?: string | null;
    trash_talk_style?: 'aggressive' | 'petty' | 'poetic' | 'silent';
  }) => request<User>('/api/users/me', { method: 'PATCH', body: JSON.stringify(data) }),

  changePassword: (data: { current_password: string; new_password: string }) =>
    request<{ message: string; token: string }>('/api/users/change-password', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getProfile: (username: string) => request<User>(`/api/users/${username}`),
};

// =============================================
// Leagues
// =============================================
export const leagues = {
  list: () => request<unknown[]>('/api/leagues'),

  create: (data: { name: string; sleeper_league_id?: string; season?: number }) =>
    request<unknown>('/api/leagues', { method: 'POST', body: JSON.stringify(data) }),

  get: (id: string) => request<unknown>(`/api/leagues/${id}`),

  syncSleeper: (id: string) =>
    request<{ message: string; week: number; scoring_format: string; synced_rosters: number; linked_users: number }>(
      `/api/leagues/${id}/sync-sleeper`, { method: 'POST' }),

  update: (id: string, data: { week?: number; status?: string }) =>
    request<unknown>(`/api/leagues/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  getMatchups: (id: string, week: number) =>
    request<unknown[]>(`/api/leagues/${id}/matchups/${week}`),

  importMatchups: (id: string, week: number) =>
    request<{ message: string; imported: number }>(`/api/leagues/${id}/import-matchups/${week}`, { method: 'POST' }),
};

// =============================================
// Teams
// =============================================
export const teams = {
  get: (id: string) => request<unknown>(`/api/teams/${id}`),
  scores: (id: string) => request<unknown[]>(`/api/teams/${id}/scores`),
  matchupHistory: (id: string) => request<unknown[]>(`/api/teams/${id}/matchup-history`),
  setRoster: (id: string, starters: string[]) =>
    request<{ message: string; roster: unknown[] }>(`/api/teams/${id}/roster`, {
      method: 'PATCH',
      body: JSON.stringify({ starters }),
    }),
};

// =============================================
// Players
// =============================================
export const players = {
  list: (params?: { position?: string; team?: string; search?: string; limit?: number }) => {
    const qs = new URLSearchParams(params as Record<string, string>).toString();
    return request<unknown[]>(`/api/players${qs ? `?${qs}` : ''}`);
  },
  get: (id: string) => request<unknown>(`/api/players/${id}`),
  sync: () => request<unknown>('/api/players/sync', { method: 'POST' }),
  nflState: () => request<{ week: number; season: string; season_type: string }>('/api/players/nfl/state'),
};

// =============================================
// Chat
// =============================================
export const chat = {
  getMessages: (leagueId: string, params?: { limit?: number; before?: string }) => {
    const qs = new URLSearchParams(params as Record<string, string>).toString();
    return request<unknown[]>(`/api/chat/${leagueId}${qs ? `?${qs}` : ''}`);
  },
  send: (leagueId: string, data: { message: string; week?: number }) =>
    request<unknown>(`/api/chat/${leagueId}`, { method: 'POST', body: JSON.stringify(data) }),
};

// =============================================
// AI
// =============================================
export const ai = {
  trashTalk: (data: { league_id: string; matchup_id: string; target_team_id: string; style?: string }) =>
    request<{ text: string }>('/api/ai/trash-talk', { method: 'POST', body: JSON.stringify(data) }),

  weeklyRecap: (data: { league_id: string; week: number }) =>
    request<{ text: string }>('/api/ai/weekly-recap', { method: 'POST', body: JSON.stringify(data) }),

  tradeReaction: (data: {
    league_id: string;
    team1_name: string;
    team1_giving: string[];
    team2_name: string;
    team2_giving: string[];
  }) => request<{ text: string }>('/api/ai/trade-reaction', { method: 'POST', body: JSON.stringify(data) }),

  lineupAdvice: (teamId: string, week: number) =>
    request<{ text: string }>(`/api/ai/lineup-advice/${teamId}/${week}`),

  waiverRecs: (leagueId: string, week: number) =>
    request<{ text: string; players: Array<{ playerName: string; position: string; nflTeam: string; projected: number; last3Avg: number; injuryStatus?: string }> }>(`/api/ai/waiver-recs/${leagueId}/${week}`),
};

// =============================================
// Trades
// =============================================
export const trades = {
  history: (leagueId: string) =>
    request<Trade[]>(`/api/trades/history?league_id=${leagueId}`),

  inbox: (leagueId: string) =>
    request<Trade[]>(`/api/trades/inbox?league_id=${leagueId}`),

  pendingApproval: (leagueId: string) =>
    request<Trade[]>(`/api/trades/pending-approval?league_id=${leagueId}`),

  propose: (data: {
    league_id: string;
    proposing_team_id: string;
    receiving_team_id: string;
    proposing_player_ids: string[];
    receiving_player_ids: string[];
    proposer_note?: string;
  }) => request<Trade>('/api/trades/propose', { method: 'POST', body: JSON.stringify(data) }),

  respond: (tradeId: string, action: 'accept' | 'reject', response_note?: string) =>
    request<Trade>(`/api/trades/${tradeId}/respond`, {
      method: 'POST',
      body: JSON.stringify({ action, response_note }),
    }),

  approve: (tradeId: string, action: 'approve' | 'veto', commissioner_note?: string) =>
    request<Trade>(`/api/trades/${tradeId}/approve`, {
      method: 'POST',
      body: JSON.stringify({ action, commissioner_note }),
    }),
};
