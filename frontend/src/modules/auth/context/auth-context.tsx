import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { ApiResponse, AppUser } from '@car-tracker/shared';
import { API_BASE } from '@/shared/api';

const LAST_ACTIVITY_KEY = 'car-tracker-last-activity';
const INACTIVITY_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 60 * 1000;

function updateLastActivity() {
  localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
}

function clearLastActivity() {
  localStorage.removeItem(LAST_ACTIVITY_KEY);
}

interface AuthContextValue {
  user: AppUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function readJson<T>(response: Response): Promise<ApiResponse<T>> {
  try {
    return await response.json() as ApiResponse<T>;
  } catch {
    throw new Error(`Request failed (${response.status})`);
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const logout = useCallback(async () => {
    setUser(null);
    clearLastActivity();
    try {
      await fetch(`${API_BASE}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // Local state is cleared even if the network is unavailable. The server
      // cookie will expire and protected endpoints still verify it.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    localStorage.removeItem('car-tracker-user');
    fetch(`${API_BASE}/api/auth/session`, { credentials: 'include' })
      .then(async (response) => {
        if (!response.ok) return null;
        const json = await readJson<AppUser>(response);
        return json.success ? json.data : null;
      })
      .then((restoredUser) => {
        if (!cancelled) {
          setUser(restoredUser);
          if (restoredUser) updateLastActivity();
        }
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!user) return;
    updateLastActivity();
    const events = ['mousedown', 'keydown', 'touchstart', 'scroll', 'mousemove', 'click'];
    const handler = () => updateLastActivity();
    events.forEach((event) => window.addEventListener(event, handler, { passive: true }));
    const interval = window.setInterval(() => {
      const lastActivity = Number(localStorage.getItem(LAST_ACTIVITY_KEY) ?? Date.now());
      if (Date.now() - lastActivity >= INACTIVITY_TIMEOUT_MS) void logout();
    }, CHECK_INTERVAL_MS);
    return () => {
      events.forEach((event) => window.removeEventListener(event, handler));
      window.clearInterval(interval);
    };
  }, [user, logout]);

  const login = useCallback(async (username: string, password: string) => {
    const response = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username.trim(), password }),
    });
    const json = await readJson<AppUser>(response);
    if (!response.ok || !json.success || !json.data) {
      throw new Error(json.error || 'Invalid credentials');
    }
    setUser(json.data);
    updateLastActivity();
  }, []);

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: user !== null, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
