import assert from 'node:assert/strict';
import { describe, it, afterEach } from 'node:test';
import type { NextFunction, Request, Response } from 'express';
import type pg from 'pg';
import { setPoolForTest } from '../db/db.js';
import { authorizeReadWrite, loadSession, requireAuthentication, requireRoles } from '../middleware/auth.js';
import { protectCookieAuthenticatedOrigin } from '../middleware/origin.js';
import { createRateLimiter } from '../middleware/rate-limit.js';
import { validateUuidParam } from '../middleware/validate-uuid.js';
import { createSessionToken, SESSION_COOKIE_NAME, verifySessionToken } from './session.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';

interface MockResponse extends Partial<Response> {
  statusCode: number;
  body?: unknown;
  headers: Record<string, string>;
  clearedCookie?: string;
}

function response(): MockResponse {
  const res: MockResponse = { statusCode: 200, headers: {} };
  res.status = ((code: number) => { res.statusCode = code; return res as Response; }) as Response['status'];
  res.json = ((body: unknown) => { res.body = body; return res as Response; }) as Response['json'];
  res.setHeader = ((name: string, value: number | string | readonly string[]) => {
    res.headers[name] = String(value);
    return res as Response;
  }) as Response['setHeader'];
  res.clearCookie = ((name: string) => { res.clearedCookie = name; return res as Response; }) as Response['clearCookie'];
  return res;
}

function request(values: Partial<Request> = {}): Request {
  const req = {
    method: 'GET',
    path: '/api/test',
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
    ...values,
  } as unknown as Request;
  req.get = ((name: string) => {
    const value = req.headers[name.toLowerCase()];
    return typeof value === 'string' ? value : undefined;
  }) as Request['get'];
  return req;
}

afterEach(() => setPoolForTest(null));

describe('signed sessions', () => {
  it('accepts a valid token and rejects tampering and expiry', () => {
    const token = createSessionToken(USER_ID, 1_000_000);
    assert.equal(verifySessionToken(token, 1_001_000)?.sub, USER_ID);
    assert.equal(verifySessionToken(`${token}x`, 1_001_000), null);
    assert.equal(verifySessionToken(token, 1_000_000 + 24 * 60 * 60 * 1000 + 1), null);
  });

  it('loads identity and current role from the database rather than request headers', async () => {
    const fakePool = {
      query: async () => ({ rows: [{
        id: USER_ID,
        name: 'Verified User',
        username: 'verified',
        user_type: 'VIEWER',
        department: 'Ops',
        picture: null,
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
      }] }),
    } as unknown as pg.Pool;
    setPoolForTest(fakePool);
    const req = request({
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${createSessionToken(USER_ID)}`,
        'x-user-type': 'SUPERADMIN',
        'x-user-id': '22222222-2222-4222-8222-222222222222',
      },
    });
    let nextCalled = false;
    await loadSession(req, response() as Response, (() => { nextCalled = true; }) as NextFunction);
    assert.equal(nextCalled, true);
    assert.equal(req.auth?.id, USER_ID);
    assert.equal(req.auth?.role, 'VIEWER');
  });
});

describe('authorization and origin protection', () => {
  it('rejects forged headers without a verified session', () => {
    const req = request({ headers: { 'x-user-type': 'SUPERADMIN', 'x-user-id': USER_ID } });
    const res = response();
    requireAuthentication(req, res as Response, (() => assert.fail('must not continue')) as NextFunction);
    assert.equal(res.statusCode, 401);
  });

  it('allows VIEWER reads and rejects VIEWER writes', () => {
    const middleware = authorizeReadWrite(['VIEWER'], []);
    const read = request({ auth: { id: USER_ID, role: 'VIEWER' } as Request['auth'] });
    let readAllowed = false;
    middleware(read, response() as Response, (() => { readAllowed = true; }) as NextFunction);
    assert.equal(readAllowed, true);

    const write = request({ method: 'PATCH', auth: read.auth });
    const res = response();
    middleware(write, res as Response, (() => assert.fail('must not continue')) as NextFunction);
    assert.equal(res.statusCode, 403);
  });

  it('enforces administrative role boundaries and UUID validation', () => {
    const adminOnly = requireRoles('SUPERADMIN', 'ADMIN');
    const viewer = request({ auth: { id: USER_ID, role: 'VIEWER' } as Request['auth'] });
    const forbidden = response();
    adminOnly(viewer, forbidden as Response, (() => assert.fail('must not continue')) as NextFunction);
    assert.equal(forbidden.statusCode, 403);

    const invalid = response();
    validateUuidParam(request(), invalid as Response, (() => assert.fail('must not continue')) as NextFunction, 'not-a-uuid', 'id');
    assert.equal(invalid.statusCode, 400);
  });

  it('rejects unsafe cookie-authenticated requests from an untrusted origin', () => {
    const req = request({
      method: 'POST',
      headers: { cookie: `${SESSION_COOKIE_NAME}=token`, origin: 'https://attacker.example' },
    });
    const res = response();
    protectCookieAuthenticatedOrigin(req, res as Response, (() => assert.fail('must not continue')) as NextFunction);
    assert.equal(res.statusCode, 403);
  });
});

describe('distributed rate limiter behavior', () => {
  it('returns 429 after the shared limit is exceeded', async () => {
    let count = 0;
    const fakePool = {
      query: async () => ({ rows: [{ request_count: ++count, expires_at: new Date(Date.now() + 60_000) }] }),
    } as unknown as pg.Pool;
    setPoolForTest(fakePool);
    const limiter = createRateLimiter({
      name: 'test', limit: 2, windowSeconds: 60, key: () => 'same-user', failClosed: true,
    });
    const statuses: number[] = [];
    await Promise.all([1, 2, 3].map(async () => {
      const res = response();
      await limiter(request(), res as Response, (() => undefined) as NextFunction);
      statuses.push(res.statusCode);
    }));
    assert.deepEqual(statuses.sort(), [200, 200, 429]);
  });

  it('fails closed for sensitive endpoints when storage is unavailable', async () => {
    setPoolForTest({ query: async () => { throw new Error('offline'); } } as unknown as pg.Pool);
    const limiter = createRateLimiter({
      name: 'sensitive', limit: 1, windowSeconds: 60, key: () => 'key', failClosed: true,
    });
    const res = response();
    await limiter(request(), res as Response, (() => assert.fail('must not continue')) as NextFunction);
    assert.equal(res.statusCode, 503);
  });
});
