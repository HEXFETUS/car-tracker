import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react';
import type { AppUser, ApiResponse } from '@car-tracker/shared';
import { API_BASE } from '@/shared/api';

const STORAGE_KEY = 'car-tracker-user';
const LAST_ACTIVITY_KEY = 'car-tracker-last-activity';
const INACTIVITY_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24 hours
const CHECK_INTERVAL_MS = 60 * 1000; // check every 60 seconds

function loadUser(): AppUser | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as AppUser;
  } catch {
    // corrupted data — ignore
  }
  return null;
}

function saveUser(user: AppUser | null) {
  if (user) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function getLastActivity(): number {
  try {
    const raw = localStorage.getItem(LAST_ACTIVITY_KEY);
    if (raw) return Number(raw);
  } catch {
    // ignore
  }
  return Date.now(); // default to now if missing
}

function updateLastActivity() {
  localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
}

function clearLastActivity() {
  localStorage.removeItem(LAST_ACTIVITY_KEY);
}

interface AuthContextValue {
  user: AppUser | null;
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(() => {
    const loadedUser = loadUser();
    // On initial load, check if the user has been inactive for too long
    if (loadedUser) {
      const lastActivity = getLastActivity();
      const elapsed = Date.now() - lastActivity;
      if (elapsed >= INACTIVITY_TIMEOUT_MS) {
        clearLastActivity();
        return null; // expired session
      }
    }
    return loadedUser;
  });

  const activityEventsRef = useRef<(() => void)[]>([]);

  useEffect(() => {
    saveUser(user);

    if (user) {
      // Ensure last activity timestamp is set when user logs in
      updateLastActivity();

      // Set up activity listeners to track user interaction
      const events = ['mousedown', 'keydown', 'touchstart', 'scroll', 'mousemove', 'click'];
      const handler = () => updateLastActivity();

      events.forEach((event) => window.addEventListener(event, handler, { passive: true }));
      activityEventsRef.current = events.map((event) => () => window.removeEventListener(event, handler));

      return () => {
        activityEventsRef.current.forEach((cleanup) => cleanup());
        activityEventsRef.current = [];
      };
    } else {
      // Clear activity tracking when logged out
      clearLastActivity();
    }
  }, [user]);

  // Periodic inactivity check — only runs when user is authenticated
  useEffect(() => {
    if (!user) return;

    const interval = setInterval(() => {
      const lastActivity = getLastActivity();
      const elapsed = Date.now() - lastActivity;
      if (elapsed >= INACTIVITY_TIMEOUT_MS) {
        // Auto-logout due to inactivity
        setUser(null);
      }
    }, CHECK_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [user]);

  const login = useCallback(async (username: string, password: string) => {
    const response = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username.trim(), password }),
    });

    let json: ApiResponse<AppUser>;
    try {
      json = await response.json();
    } catch {
      throw new Error(`Login request failed (${response.status})`);
    }

    if (!json.success || !json.data) {
      throw new Error(json.error || 'Invalid credentials');
    }

    setUser(json.data);
  }, []);

  const logout = useCallback(() => {
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: user !== null,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}