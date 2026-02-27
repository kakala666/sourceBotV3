import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AdminInfo, LoginInput, LoginResponse, ApiResponse } from 'shared';
import api from '@/services/api';

interface AuthState {
  token: string | null;
  admin: AdminInfo | null;
  login: (input: LoginInput) => Promise<void>;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      admin: null,

      login: async (input: LoginInput) => {
        const { data } = await api.post<ApiResponse<LoginResponse>>(
          '/auth/login',
          input,
        );
        const result = data.data!;
        localStorage.setItem('token', result.token);
        set({ token: result.token, admin: result.admin });
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
