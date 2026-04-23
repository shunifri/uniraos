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
  phone?: string;
  email?: string;
  roles: UserRole[];
  department?: { id: string; name: string; path: string };
  permissions?: string[];
}

interface AuthState {
  token: string | null;
  user: User | null;
  isAdmin: boolean;
  isDeveloper: boolean;
  isAnonymous: boolean;
  embeddedRole?: string;

  login: (username: string, password: string) => Promise<void>;
  loginAnonymous: (phone: string) => Promise<void>;
  logout: () => void;
  checkSession: () => Promise<void>;
  setUser: (user: User) => void;
  hasPermission: (perm: string) => boolean;
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
      isAnonymous: false,
      embeddedRole: undefined,

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
        set({ token: data.token, user: data.user, isAdmin, isDeveloper, isAnonymous: false });
      },

      loginAnonymous: async (phone: string) => {
        const res = await fetch('/api/auth/anonymous', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone }),
        });
        const data = await res.json();
        if (!data.success) {
          throw new Error(data.error || 'Anonymous login failed');
        }
        // 存储手机号到 localStorage，方便下次自动登录
        localStorage.setItem('raos-anon-phone', phone);
        set({ token: data.token, user: data.user, isAdmin: false, isDeveloper: false, isAnonymous: true });
      },

      logout: () => {
        set({ token: null, user: null, isAdmin: false, isDeveloper: false, isAnonymous: false });
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
          const isAnonymous = (user.roles ?? []).some((r: any) => (typeof r === 'string' ? r : r.name) === 'anonymous');
          set({ user, isAdmin, isDeveloper, isAnonymous });
        } catch {
          get().logout();
        }
      },

      setUser: (user: User) => {
        const { isAdmin, isDeveloper } = computeRoles(user.roles ?? []);
        const isAnonymous = (user.roles ?? []).some((r: any) => (typeof r === 'string' ? r : r.name) === 'anonymous');
        set({ user, isAdmin, isDeveloper, isAnonymous });
      },

      hasPermission: (perm: string) => {
        const { user, isAdmin } = get();
        if (isAdmin) return true;
        return user?.permissions?.includes(perm) ?? false;
      },
    }),
    {
      name: 'raos-auth',
      partialize: (state) => ({ token: state.token }),
    },
  ),
);
