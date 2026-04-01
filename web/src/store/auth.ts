import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface UserRole {
  id: string;
  name: string;
}

export interface User {
  id: string;
  username: string;
  displayName: string;
  roles: UserRole[];
  department?: { id: string; name: string; path: string };
}

interface AuthState {
  token: string | null;
  user: User | null;
  isAdmin: boolean;
  isDeveloper: boolean;

  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  checkSession: () => Promise<void>;
  setUser: (user: User) => void;
}

function computeRoles(roles: UserRole[] | string[]) {
  const names = roles.map((r: any) => typeof r === 'string' ? r : r.name);
  const isAdmin = names.includes('admin');
  return {
    isAdmin,
    isDeveloper: isAdmin || names.includes('developer'),
  };
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      isAdmin: false,
      isDeveloper: false,

      login: async (username: string, password: string) => {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        });
        const data = await res.json();
        if (!data.success) {
          throw new Error(data.error || 'Login failed');
        }
        const { isAdmin, isDeveloper } = computeRoles(data.user.roles ?? []);
        set({ token: data.token, user: data.user, isAdmin, isDeveloper });
      },

      logout: () => {
        set({ token: null, user: null, isAdmin: false, isDeveloper: false });
      },

      checkSession: async () => {
        const { token } = get();
        if (!token) return;
        try {
          const res = await fetch('/api/auth/me', {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!res.ok) {
            get().logout();
            return;
          }
          const data = await res.json();
          const user: User = data.user ?? data;
          const { isAdmin, isDeveloper } = computeRoles(user.roles ?? []);
          set({ user, isAdmin, isDeveloper });
        } catch {
          get().logout();
        }
      },

      setUser: (user: User) => {
        const { isAdmin, isDeveloper } = computeRoles(user.roles ?? []);
        set({ user, isAdmin, isDeveloper });
      },
    }),
    {
      name: 'raos-auth',
      partialize: (state) => ({ token: state.token }),
    },
  ),
);
