import type { NextFunction, Request, Response } from 'express';
import { APP_ORIGINS, NODE_ENV } from '../config/env.js';
import { hasSessionCookie } from '../security/session.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function normalize(origin: string): string {
  return origin.trim().replace(/\/$/, '');
}

export function isAllowedOrigin(origin: string | undefined, req?: Request): boolean {
  if (!origin) return false;
  const normalized = normalize(origin);
  if (APP_ORIGINS.includes(normalized)) return true;

  if (req) {
    const forwardedProto = req.headers['x-forwarded-proto'];
    const protocol = typeof forwardedProto === 'string' ? forwardedProto.split(',')[0].trim() : req.protocol;
    const host = req.get('host');
    if (host && normalized === `${protocol}://${host}`) return true;
  }

  if (NODE_ENV !== 'production') {
    try {
      const url = new URL(normalized);
      return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    } catch {
      return false;
    }
  }
  return false;
}

export function protectCookieAuthenticatedOrigin(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
  // Browsers provide Origin for unsafe methods. Reject an explicitly untrusted
  // browser origin for every endpoint, and require Origin whenever a session
  // cookie is being used. Non-browser clients may call public/cron endpoints
  // without Origin because they do not carry browser session authority.
  if ((origin && !isAllowedOrigin(origin, req)) || (!origin && hasSessionCookie(req))) {
    res.status(403).json({ success: false, data: null, error: 'Request origin is not allowed' });
    return;
  }
  next();
}
