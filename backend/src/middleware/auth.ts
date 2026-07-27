import type { NextFunction, Request, Response } from 'express';
import { getPool } from '../db/db.js';
import { clearSessionCookie, getSessionToken, verifySessionToken } from '../security/session.js';

export type UserRole = 'SUPERADMIN' | 'ADMIN' | 'DISPATCHER' | 'HR' | 'VIEWER';

export interface AuthenticatedUser {
  id: string;
  name: string;
  username: string;
  role: UserRole;
  department: string;
  picture?: string;
  createdAt: string;
  updatedAt: string;
}

interface AuthUserRow {
  id: string;
  name: string;
  username: string;
  user_type: string;
  department: string;
  picture: string | null;
  created_at: string;
  updated_at: string;
}

const VALID_ROLES = new Set<UserRole>(['SUPERADMIN', 'ADMIN', 'DISPATCHER', 'HR', 'VIEWER']);
export const ALL_ROLES: UserRole[] = ['SUPERADMIN', 'ADMIN', 'DISPATCHER', 'HR', 'VIEWER'];
export const OPERATIONAL_ROLES: UserRole[] = ['SUPERADMIN', 'ADMIN', 'DISPATCHER', 'HR'];

export function toPublicUser(user: AuthenticatedUser) {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    userType: user.role,
    department: user.department,
    picture: user.picture,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export async function loadSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = getSessionToken(req);
  if (!token) {
    next();
    return;
  }

  const session = verifySessionToken(token);
  if (!session) {
    clearSessionCookie(res);
    next();
    return;
  }

  try {
    const result = await getPool().query<AuthUserRow>(
      `SELECT id, name, username, user_type, department, picture, created_at, updated_at
       FROM users WHERE id = $1`,
      [session.sub],
    );
    const row = result.rows[0];
    if (!row || !VALID_ROLES.has(row.user_type as UserRole)) {
      clearSessionCookie(res);
      next();
      return;
    }

    req.auth = {
      id: row.id,
      name: row.name,
      username: row.username,
      role: row.user_type as UserRole,
      department: row.department,
      picture: row.picture ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
    next();
  } catch (error) {
    console.error('[auth] Failed to resolve session user:', (error as Error).message);
    res.status(503).json({ success: false, data: null, error: 'Authentication service unavailable' });
  }
}

export function requireAuthentication(req: Request, res: Response, next: NextFunction): void {
  if (!req.auth) {
    res.status(401).json({ success: false, data: null, error: 'Authentication required' });
    return;
  }
  next();
}

export function requireRoles(...roles: UserRole[]) {
  const allowed = new Set(roles);
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.auth) {
      res.status(401).json({ success: false, data: null, error: 'Authentication required' });
      return;
    }
    if (!allowed.has(req.auth.role)) {
      res.status(403).json({ success: false, data: null, error: 'Access denied' });
      return;
    }
    next();
  };
}

export function authorizeReadWrite(readRoles: UserRole[], writeRoles: UserRole[]) {
  const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);
  const read = new Set(readRoles);
  const write = new Set(writeRoles);
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.auth) {
      res.status(401).json({ success: false, data: null, error: 'Authentication required' });
      return;
    }
    const allowed = safeMethods.has(req.method) ? read : write;
    if (!allowed.has(req.auth.role)) {
      res.status(403).json({ success: false, data: null, error: 'Access denied' });
      return;
    }
    next();
  };
}
