import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import type { AppUser, ApiResponse } from '@car-tracker/shared';
import { API_BASE } from '@/shared/api';

const STORAGE_KEY = 'car-tracker-user';

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

interface AuthContextValue {
  user: AppUser | null;
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(() => loadUser());

  useEffect(() => {
    saveUser(user);
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
