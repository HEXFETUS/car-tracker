import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import type { User } from '@car-tracker/shared';

const MOCK_USER: User = {
  id: '1',
  name: 'Alex Driver',
  email: 'alex.driver@fleet.com',
  username: 'alex_driver',
  role: 'Fleet Manager',
  createdAt: '2024-01-15T08:00:00Z',
};

interface AuthContextValue {
  user: User | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);

  const login = useCallback(async (_email: string, _password: string) => {
    // Simulate async auth delay
    await new Promise((r) => setTimeout(r, 600));
    setUser(MOCK_USER);
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