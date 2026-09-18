import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from './api';

export type Role = 'ADMIN' | 'PHARMACIST' | 'TECHNICIAN' | 'CASHIER';
export interface SessionUser { id: string; name: string; email: string; role: Role }

interface AuthCtx {
  user: SessionUser | null;
  token: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  ready: boolean;
}

const Ctx = createContext<AuthCtx>({ user: null, token: null, login: async () => {}, logout: () => {}, ready: false });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('pharma_token'));
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const cached = localStorage.getItem('pharma_user');
    if (cached && token) {
      try { setUser(JSON.parse(cached)); } catch { /* ignore */ }
    }
    if (!token) { setReady(true); return; }
    api.get('/api/auth/me')
      .then((r) => {
        setUser(r.data.user);
        localStorage.setItem('pharma_user', JSON.stringify(r.data.user));
      })
      .catch(() => {
        setUser(null); setToken(null);
        localStorage.removeItem('pharma_token');
        localStorage.removeItem('pharma_user');
      })
      .finally(() => setReady(true));
  }, [token]);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api.post('/api/auth/login', { email, password });
    localStorage.setItem('pharma_token', r.data.token);
    localStorage.setItem('pharma_user', JSON.stringify(r.data.user));
    setToken(r.data.token);
    setUser(r.data.user);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('pharma_token');
    localStorage.removeItem('pharma_user');
    setToken(null); setUser(null);
  }, []);

  const value = useMemo(() => ({ user, token, login, logout, ready }), [user, token, login, logout, ready]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() { return useContext(Ctx); }

export function can(user: SessionUser | null, ...roles: Role[]): boolean {
  if (!user) return false;
  return roles.includes(user.role);
}
