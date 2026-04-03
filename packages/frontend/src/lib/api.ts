import type { User, Trade, RosterPlayer, AvailablePlayer, Transaction, WaiverClaim } from '@/types';

// Empty string → relative paths → Next.js dev proxy routes to localhost:3001 (no CORS).
// In production, set NEXT_PUBLIC_API_URL to the full backend URL (e.g. Railway).
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '';

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
  const url = `${API_BASE}${path}`;
  const token = getToken();

  let res: Response;
  try {
    res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
  } catch (networkErr) {
    // Network error, CORS failure, or DNS failure — fetch itself threw
    const msg = (networkErr as Error).message || 'Network error';
    console.error(`[API] ${options.method || 'GET'} ${url} → NETWORK ERROR: ${msg}`);
    throw new Error(`Cannot reach server: ${msg}`);
  }

  if (res.status === 401) {
    const body = await res.json().catch(() => ({ code: '' }));
    if (body.code === 'TOKEN_EXPIRED' || body.code === 'INVALID_TOKEN' || body.code === 'NO_TOKEN') {
      handleUnauthenticated();
      throw new Error('Session expired. Please sign in again.');
    }
    throw new Error(body.error || 'Unauthorized');
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    console.error(`[API] ${options.method || 'GET'} ${url} → ${res.status}:`, err.error || err);
    const apiErr = Object.assign(new Error(err.error || `HTTP ${res.status}`), err);
    throw apiErr;
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

  create: (data: { name: string; sleeper_league_id?: string; season?: number; league_size?: number; scoring_type?: string; scoring_source?: string }) =>
    request<unknown>('/api/leagues', { method: 'POST', body: JSON.stringify(data) }),

  get: (id: string) => request<unknown>(`/api/leagues/${id}`),

  join: (invite_code: string) =>
    request<{ message: string; league_id: string; role: string }>('/api/leagues/join', {
      method: 'POST',
      body: JSON.stringify({ invite_code }),
    }),

  syncSleeper: (id: string) =>
    request<{ message: string; week: number; scoring_format: string; synced_rosters: number; linked_users: number }>(
      `/api/leagues/${id}/sync-sleeper`, { method: 'POST' }),

  update: (id: string, data: { week?: number; status?: string }) =>
    request<unknown>(`/api/leagues/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  getMatchups: (id: string, week: number) =>
    request<unknown[]>(`/api/leagues/${id}/matchups/${week}`),

  importMatchups: (id: string, week: number) =>
    request<{ message: string; imported: number }>(`/api/leagues/${id}/import-matchups/${week}`, { method: 'POST' }),

  generateSchedule: (id: string, weeks?: number) =>
    request<{ message: string; matchups_created: number; weeks_skipped: number }>(
      `/api/leagues/${id}/generate-schedule${weeks ? `?weeks=${weeks}` : ''}`,
      { method: 'POST' }
    ),

  simulateWeek: (id: string) =>
    request<{ message: string; week: number; scoring_source: string; matchups_scored: number; next_week: number }>(
      `/api/leagues/${id}/simulate-week`, { method: 'POST' }
    ),

  scoreWeek: (id: string) =>
    request<{ message: string; week: number; scoring_source: string; matchups_scored: number; next_week: number }>(
      `/api/leagues/${id}/score-week`, { method: 'POST' }
    ),

  syncStats: (season: number, week: number) =>
    request<{ season: number; week: number; synced: number; skipped: number; errors: number }>(
      '/api/players/sync-stats', { method: 'POST', body: JSON.stringify({ season, week }) }
    ),

  debugWeek: (week: number, season?: number) =>
    request<{ stats_loaded: boolean; total_player_stats: number; top_players: unknown[] }>(
      `/api/players/debug/week/${week}${season ? `?season=${season}` : ''}`
    ),

  unlockLineup: (id: string) =>
    request<{ message: string; lineup_locked_week: number }>(
      `/api/leagues/${id}/unlock-lineup`, { method: 'POST' }
    ),

  transactions: (id: string, limit?: number) =>
    request<Transaction[]>(`/api/leagues/${id}/transactions${limit ? `?limit=${limit}` : ''}`),

  waiverClaim: (leagueId: string, player_id: string) =>
    request<{ message: string; claim: WaiverClaim }>(`/api/leagues/${leagueId}/waivers/claim`, {
      method: 'POST', body: JSON.stringify({ player_id }),
    }),

  waiverCancel: (leagueId: string, claimId: string) =>
    request<{ message: string }>(`/api/leagues/${leagueId}/waivers/claim/${claimId}`, {
      method: 'DELETE',
    }),

  waiverList: (leagueId: string, status?: string) =>
    request<WaiverClaim[]>(`/api/leagues/${leagueId}/waivers${status ? `?status=${status}` : ''}`),

  waiverMyClaims: (leagueId: string) =>
    request<WaiverClaim[]>(`/api/leagues/${leagueId}/waivers/my-claims`),

  waiverProcess: (leagueId: string) =>
    request<{ message: string; approved: number; rejected: number }>(
      `/api/leagues/${leagueId}/waivers/process`, { method: 'POST' }
    ),
};

// =============================================
// Teams
// =============================================
export const teams = {
  create: (data: { league_id: string; name: string }) =>
    request<unknown>('/api/teams', { method: 'POST', body: JSON.stringify(data) }),
  get: (id: string) => request<unknown>(`/api/teams/${id}`),
  scores: (id: string) => request<unknown[]>(`/api/teams/${id}/scores`),
  matchupHistory: (id: string) => request<unknown[]>(`/api/teams/${id}/matchup-history`),
  setRoster: (id: string, starters: string[]) =>
    request<{ message: string; roster: unknown[] }>(`/api/teams/${id}/roster`, {
      method: 'PATCH',
      body: JSON.stringify({ starters }),
    }),
  setSlot: (teamId: string, player_id: string, slot: string) =>
    request<{ message: string; roster: RosterPlayer[] }>(`/api/teams/${teamId}/roster/slot`, {
      method: 'PATCH',
      body: JSON.stringify({ player_id, slot }),
    }),
  available: (teamId: string, params?: { position?: string; search?: string; limit?: number }) => {
    const qs = new URLSearchParams(params as Record<string, string>).toString();
    return request<AvailablePlayer[]>(`/api/teams/${teamId}/available${qs ? `?${qs}` : ''}`);
  },
  lineupLock: (id: string) =>
    request<{ locked_player_ids: string[]; locked_players: { id: string; name: string; nfl_team: string; game_start: string }[] }>(
      `/api/teams/${id}/lineup-lock`
    ),

  addPlayer: (teamId: string, player_id: string) =>
    request<{ message: string; player_id: string; roster_slot: string | null }>(`/api/teams/${teamId}/add`, {
      method: 'POST',
      body: JSON.stringify({ player_id }),
    }),

  dropPlayer: (teamId: string, player_id: string) =>
    request<{ message: string; player_id: string }>(`/api/teams/${teamId}/drop/${player_id}`, {
      method: 'DELETE',
    }),
};

// =============================================
// Players
// =============================================
export const players = {
  list: (params?: { position?: string; team?: string; search?: string; limit?: number; league_id?: string }) => {
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
// Invites
// =============================================
export const invites = {
  generate: (leagueId: string, opts?: { max_uses?: number; expires_in_days?: number }) =>
    request<unknown>(`/api/leagues/${leagueId}/invite`, { method: 'POST', body: JSON.stringify(opts || {}) }),

  getCurrent: (leagueId: string) =>
    request<unknown>(`/api/leagues/${leagueId}/invite`),

  deactivate: (leagueId: string) =>
    request<{ message: string }>(`/api/leagues/${leagueId}/invite`, { method: 'DELETE' }),

  preview: (code: string) =>
    request<unknown>(`/api/invites/${code}`),

  join: (code: string) =>
    request<{ message: string; league_id: string; team: unknown }>(`/api/invites/${code}/join`, { method: 'POST', body: '{}' }),

  joinByCode: (code: string) =>
    request<{ message: string; league_id: string; team: unknown }>('/api/leagues/join', { method: 'POST', body: JSON.stringify({ code }) }),

  history: (leagueId: string) =>
    request<unknown[]>(`/api/leagues/${leagueId}/invites`),
};

// =============================================
// Draft
// =============================================
export const draft = {
  start: (leagueId: string, data?: { total_rounds?: number; seconds_per_pick?: number }) =>
    request<unknown>(`/api/draft/${leagueId}/start`, { method: 'POST', body: JSON.stringify(data || {}) }),

  getState: (leagueId: string) =>
    request<unknown>(`/api/draft/${leagueId}/state`),

  pick: (leagueId: string, player_id: string) =>
    request<unknown>(`/api/draft/${leagueId}/pick`, { method: 'POST', body: JSON.stringify({ player_id }) }),

  available: (leagueId: string, params?: { position?: string; search?: string; limit?: number }) => {
    const qs = new URLSearchParams(params as Record<string, string>).toString();
    return request<unknown[]>(`/api/draft/${leagueId}/available${qs ? `?${qs}` : ''}`);
  },
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
