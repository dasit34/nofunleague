import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User, League } from '@/types';

interface AuthState {
  user: User | null;
  token: string | null;
  setAuth: (user: User, token: string) => void;
  updateUser: (user: Partial<User>) => void;
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

      updateUser: (partial) => {
        set((state) => ({
          user: state.user ? { ...state.user, ...partial } : null,
        }));
      },

      clearAuth: () => {
        localStorage.removeItem('nfl_token');
        set({ user: null, token: null });
      },
    }),
    {
      name: 'nfl-auth',
      partialize: (state) => ({ user: state.user, token: state.token }),
      // Re-hydrate token into localStorage so getToken() in api.ts finds it
      onRehydrateStorage: () => (state) => {
        if (state?.token) {
          localStorage.setItem('nfl_token', state.token);
        }
      },
    }
  )
);

interface LeagueState {
  activeLeague: League | null;
  setActiveLeague: (league: League | null) => void;
}

export const useLeagueStore = create<LeagueState>()(
  persist(
    (set) => ({
      activeLeague: null,
      setActiveLeague: (league) => set({ activeLeague: league }),
    }),
    {
      name: 'nfl-league',
      partialize: (state) => ({ activeLeague: state.activeLeague }),
    }
  )
);
