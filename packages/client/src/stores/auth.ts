import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AdminInfo } from 'shared';

interface AuthState {
  token: string | null;
  admin: AdminInfo | null;
  setAuth: (token: string, admin: AdminInfo) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      admin: null,

      setAuth: (token: string, admin: AdminInfo) => {
        localStorage.setItem('token', token);
        set({ token, admin });
      },

      logout: () => {
        localStorage.removeItem('token');
        set({ token: null, admin: null });
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({ token: state.token, admin: state.admin }),
    },
  ),
);
