import type { Request, Response, NextFunction } from 'express';

export type UserRole = 'SUPERADMIN' | 'ADMIN' | 'DISPATCHER' | 'HR' | 'VIEWER';

/**
 * Role-based route access configuration.
 * Maps route prefixes to allowed user roles.
 * Uses originalUrl prefixes since Express strips mount points from req.path.
 */
const ROUTE_ACCESS: Record<string, UserRole[]> = {
  '/api/vehicles': ['SUPERADMIN', 'ADMIN', 'DISPATCHER'],
  '/vehicles': ['SUPERADMIN', 'ADMIN', 'DISPATCHER'],
  '/api/drivers': ['SUPERADMIN', 'ADMIN', 'DISPATCHER'],
  '/drivers': ['SUPERADMIN', 'ADMIN', 'DISPATCHER'],
  '/api/travel-orders': ['SUPERADMIN', 'ADMIN', 'DISPATCHER', 'HR', 'VIEWER'],
  '/travel-orders': ['SUPERADMIN', 'ADMIN', 'DISPATCHER', 'HR', 'VIEWER'],
  '/api/gps-logs': ['SUPERADMIN', 'ADMIN', 'DISPATCHER'],
  '/gps-logs': ['SUPERADMIN', 'ADMIN', 'DISPATCHER'],
  '/api/users': ['SUPERADMIN', 'ADMIN'],
  '/users': ['SUPERADMIN', 'ADMIN'],
  '/api/reports': ['SUPERADMIN', 'ADMIN', 'VIEWER'],
  '/reports': ['SUPERADMIN', 'ADMIN', 'VIEWER'],
  '/api/maintenance': ['SUPERADMIN', 'ADMIN', 'DISPATCHER'],
  '/maintenance': ['SUPERADMIN', 'ADMIN', 'DISPATCHER'],
  '/api/settings': ['SUPERADMIN'],
  '/settings': ['SUPERADMIN'],
};

/**
 * Get allowed roles for a given path (matched against originalUrl).
 */
function getAllowedRoles(path: string): UserRole[] | null {
  for (const [prefix, roles] of Object.entries(ROUTE_ACCESS)) {
    if (path.startsWith(prefix)) {
      return roles;
    }
  }
  return null; // No restriction
}

/**
 * Express middleware that checks if the authenticated user has access
 * to the requested route based on their user type.
 *
 * The frontend must set the x-user-type header on each request.
 */
export function requireRole(req: Request, res: Response, next: NextFunction): void {
  const userType = req.headers['x-user-type'] as UserRole | undefined;

  if (!userType) {
    res.status(401).json({
      success: false,
      data: null,
      error: 'Authentication required',
    });
    return;
  }

  // SUPERADMIN has unrestricted access
  if (userType === 'SUPERADMIN') {
    next();
    return;
  }

  // Use originalUrl to match against mounted route prefixes
  const allowedRoles = getAllowedRoles(req.originalUrl);

  // If no restriction defined, allow access
  if (!allowedRoles) {
    next();
    return;
  }

  if (!allowedRoles.includes(userType)) {
    res.status(403).json({
      success: false,
      data: null,
      error: 'Access denied. You do not have permission to access this resource.',
    });
    return;
  }

  next();
}
