const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('nfl_token');
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
  register: (data: { username: string; email: string; password: string; display_name?: string; trash_talk_style?: string }) =>
    request<{ user: unknown; token: string }>('/api/users/register', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  login: (data: { email: string; password: string }) =>
    request<{ user: unknown; token: string }>('/api/users/login', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  me: () => request<unknown>('/api/users/me'),

  updateProfile: (data: Record<string, unknown>) =>
    request<unknown>('/api/users/me', { method: 'PATCH', body: JSON.stringify(data) }),
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
    request<unknown>(`/api/leagues/${id}/sync-sleeper`, { method: 'POST' }),

  getMatchups: (id: string, week: number) =>
    request<unknown[]>(`/api/leagues/${id}/matchups/${week}`),

  importMatchups: (id: string, week: number) =>
    request<unknown>(`/api/leagues/${id}/import-matchups/${week}`, { method: 'POST' }),
};

// =============================================
// Teams
// =============================================
export const teams = {
  get: (id: string) => request<unknown>(`/api/teams/${id}`),
  scores: (id: string) => request<unknown[]>(`/api/teams/${id}/scores`),
  matchupHistory: (id: string) => request<unknown[]>(`/api/teams/${id}/matchup-history`),
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
};
