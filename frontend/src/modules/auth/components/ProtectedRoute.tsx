import { Navigate, useLocation } from 'react-router';
import { useAuth } from '@/modules/auth/context/auth-context';
import { canAccessNav } from '@/shared/config/role-access';
import type { ReactNode } from 'react';

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, user } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) return <Navigate to="/login" replace />;

  // Role-based page access check
  if (user && !canAccessNav(location.pathname, user.userType)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

export function PublicRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  if (isAuthenticated) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function RoleRoute({
  children,
  allowedRoles,
}: {
  children: ReactNode;
  allowedRoles: string[];
}) {
  const { isAuthenticated, user } = useAuth();

  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!user || !allowedRoles.includes(user.userType)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
