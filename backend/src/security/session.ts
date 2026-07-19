import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { AUTH_SECRET, NODE_ENV } from '../config/env.js';

export const SESSION_COOKIE_NAME = 'car_tracker_session';
export const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface SessionPayload {
  sub: string;
  iat: number;
  exp: number;
  v: 1;
}

const developmentSecret = 'car-tracker-development-secret-only-change-me';

function signingSecret(): string {
  return AUTH_SECRET.length >= 32 ? AUTH_SECRET : developmentSecret;
}

function signature(value: string): Buffer {
  return createHmac('sha256', signingSecret()).update(value).digest();
}

export function createSessionToken(userId: string, now = Date.now()): string {
  const payload: SessionPayload = {
    sub: userId,
    iat: Math.floor(now / 1000),
    exp: Math.floor((now + SESSION_MAX_AGE_MS) / 1000),
    v: 1,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${signature(encoded).toString('base64url')}`;
}

export function verifySessionToken(token: string, now = Date.now()): SessionPayload | null {
  const [encoded, suppliedSignature, extra] = token.split('.');
  if (!encoded || !suppliedSignature || extra) return null;

  let supplied: Buffer;
  try {
    supplied = Buffer.from(suppliedSignature, 'base64url');
  } catch {
    return null;
  }

  const expected = signature(encoded);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Partial<SessionPayload>;
    const nowSeconds = Math.floor(now / 1000);
    if (
      payload.v !== 1 ||
      typeof payload.sub !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.sub) ||
      typeof payload.iat !== 'number' ||
      typeof payload.exp !== 'number' ||
      payload.iat > nowSeconds + 60 ||
      payload.exp <= nowSeconds
    ) {
      return null;
    }
    return payload as SessionPayload;
  } catch {
    return null;
  }
}

function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie;
  if (!header) return {};
  return Object.fromEntries(header.split(';').flatMap((part) => {
    const separator = part.indexOf('=');
    if (separator < 1) return [];
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    try {
      return [[key, decodeURIComponent(value)]];
    } catch {
      return [];
    }
  }));
}

export function getSessionToken(req: Request): string | null {
  return parseCookies(req)[SESSION_COOKIE_NAME] ?? null;
}

export function hasSessionCookie(req: Request): boolean {
  return Boolean(getSessionToken(req));
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_MS,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });
}
