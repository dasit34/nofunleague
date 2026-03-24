import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User, League } from '@/types';

interface AuthState {
  user: User | null;
  token: string | null;
  setAuth: (user: User, token: string) => void;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      setAuth: (user, token) => {
        localStorage.setItem('nfl_token', token);
        set({ user, token });
      },
      clearAuth: () => {
        localStorage.removeItem('nfl_token');
        set({ user: null, token: null });
      },
    }),
    {
      name: 'nfl-auth',
      partialize: (state) => ({ user: state.user, token: state.token }),
    }
  )
);

interface LeagueState {
  activeLeague: League | null;
  setActiveLeague: (league: League | null) => void;
}

export const useLeagueStore = create<LeagueState>()((set) => ({
  activeLeague: null,
  setActiveLeague: (league) => set({ activeLeague: league }),
}));
