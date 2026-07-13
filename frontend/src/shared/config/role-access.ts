import type { AppUser } from '@car-tracker/shared';

export type UserRole = AppUser['userType'];

/**
 * Role-based access rules for navigation items.
 * Maps each navigation route to the roles allowed to see it.
 */
export const NAV_ACCESS: Record<string, UserRole[]> = {
  '/': ['SUPERADMIN', 'ADMIN', 'DISPATCHER', 'HR', 'VIEWER'],
  '/travel-orders': ['SUPERADMIN', 'ADMIN', 'DISPATCHER', 'HR', 'VIEWER'],
  '/travel-requests': ['SUPERADMIN', 'DISPATCHER', 'VIEWER'],
  '/gps-logs': ['SUPERADMIN', 'ADMIN', 'DISPATCHER', 'HR'],
  '/list': ['SUPERADMIN', 'ADMIN', 'DISPATCHER', 'HR'],
  '/reports': ['SUPERADMIN', 'ADMIN', 'VIEWER'],
  '/settings': ['SUPERADMIN'],
};

/**
 * Role-based access rules for tabs within pages.
 * Maps page + tab key to allowed roles.
 */
export const TAB_ACCESS: Record<string, UserRole[]> = {
  // Travel Orders Tabs
  'travel-orders:pending': ['SUPERADMIN', 'HR', 'VIEWER'],
  'travel-orders:for-approval': ['SUPERADMIN', 'ADMIN', 'VIEWER'],
  'travel-orders:approved': ['SUPERADMIN', 'ADMIN', 'DISPATCHER', 'HR', 'VIEWER'],
  'travel-orders:cancelled': ['SUPERADMIN', 'ADMIN', 'DISPATCHER', 'HR', 'VIEWER'],
  // Travel Requests Tabs
  'requests:request': ['SUPERADMIN', 'DISPATCHER', 'VIEWER'],
  'requests:schedule': ['SUPERADMIN', 'DISPATCHER', 'HR', 'VIEWER'],
};

/**
 * Check if a user role has access to a given navigation path.
 */
export function canAccessNav(path: string, role: UserRole): boolean {
  if (role === 'SUPERADMIN') return true;
  const allowed = NAV_ACCESS[path];
  return allowed ? allowed.includes(role) : false;
}

/**
 * Check if a user role has access to a given tab within a page.
 */
export function canAccessTab(pageKey: string, tabKey: string, role: UserRole): boolean {
  if (role === 'SUPERADMIN') return true;
  const key = `${pageKey}:${tabKey}`;
  const allowed = TAB_ACCESS[key];
  return allowed ? allowed.includes(role) : false;
}
