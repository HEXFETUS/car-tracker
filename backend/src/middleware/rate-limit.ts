import { createHash } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { getPool } from '../db/db.js';

interface RateLimitOptions {
  name: string;
  limit: number;
  windowSeconds: number;
  key: (req: Request) => string;
  failClosed: boolean;
  skip?: (req: Request) => boolean;
}

interface BucketRow {
  request_count: number;
  expires_at: string | Date;
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function getClientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

async function incrementBucket(bucketKey: string, windowSeconds: number): Promise<BucketRow> {
  const pool = getPool();
  const result = await pool.query<BucketRow>(
    `INSERT INTO rate_limit_buckets
       (bucket_key, window_started_at, request_count, expires_at)
     VALUES ($1, now(), 1, now() + ($2 * interval '1 second'))
     ON CONFLICT (bucket_key) DO UPDATE SET
       window_started_at = CASE
         WHEN rate_limit_buckets.expires_at <= now() THEN now()
         ELSE rate_limit_buckets.window_started_at
       END,
       request_count = CASE
         WHEN rate_limit_buckets.expires_at <= now() THEN 1
         ELSE rate_limit_buckets.request_count + 1
       END,
       expires_at = CASE
         WHEN rate_limit_buckets.expires_at <= now() THEN now() + ($2 * interval '1 second')
         ELSE rate_limit_buckets.expires_at
       END
     RETURNING request_count, expires_at`,
    [bucketKey, windowSeconds],
  );
  if (Math.random() < 0.01) {
    try {
      await pool.query('DELETE FROM rate_limit_buckets WHERE expires_at < now() - interval \'1 day\'');
    } catch (error) {
      console.error('[rate-limit:cleanup]', (error as Error).message);
    }
  }
  return result.rows[0];
}

export function createRateLimiter(options: RateLimitOptions) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (options.skip?.(req)) {
      next();
      return;
    }

    const identifier = options.key(req);
    const bucketKey = `${options.name}:${digest(identifier)}`;

    try {
      const bucket = await incrementBucket(bucketKey, options.windowSeconds);
      const expiresAt = new Date(bucket.expires_at).getTime();
      const retryAfter = Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000));
      const remaining = Math.max(0, options.limit - bucket.request_count);

      res.setHeader('RateLimit-Limit', String(options.limit));
      res.setHeader('RateLimit-Remaining', String(remaining));
      res.setHeader('RateLimit-Reset', String(retryAfter));
      res.setHeader('X-RateLimit-Limit', String(options.limit));
      res.setHeader('X-RateLimit-Remaining', String(remaining));
      res.setHeader('X-RateLimit-Reset', String(Math.ceil(expiresAt / 1000)));

      if (bucket.request_count > options.limit) {
        res.setHeader('Retry-After', String(retryAfter));
        res.status(429).json({
          success: false,
          data: null,
          error: 'Too many requests. Please try again later.',
          retryAfter,
        });
        return;
      }
      next();
    } catch (error) {
      console.error(`[rate-limit:${options.name}]`, (error as Error).message);
      if (options.failClosed) {
        res.status(503).json({ success: false, data: null, error: 'Request protection service unavailable' });
        return;
      }
      next();
    }
  };
}

export const generalRateLimit = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const authenticated = Boolean(req.auth);
  return createRateLimiter({
    name: authenticated ? 'general-user-5m' : 'general-ip-5m',
    limit: authenticated ? 600 : 120,
    windowSeconds: 5 * 60,
    key: () => authenticated ? req.auth!.id : getClientIp(req),
    failClosed: false,
    skip: () => req.path === '/api/health' || req.path === '/health',
  })(req, res, next);
};

export const loginUsernameRateLimit = createRateLimiter({
  name: 'login-username-ip-15m',
  limit: 10,
  windowSeconds: 15 * 60,
  key: (req) => `${getClientIp(req)}:${String(req.body?.username ?? '').trim().toLowerCase()}`,
  failClosed: true,
});

export const loginIpRateLimit = createRateLimiter({
  name: 'login-ip-15m',
  limit: 30,
  windowSeconds: 15 * 60,
  key: getClientIp,
  failClosed: true,
});

export const publicSubmissionRateLimit = createRateLimiter({
  name: 'public-travel-order-ip-1h',
  limit: 10,
  windowSeconds: 60 * 60,
  key: getClientIp,
  failClosed: true,
});

export const expensiveOperationRateLimit = createRateLimiter({
  name: 'expensive-user-15m',
  limit: 5,
  windowSeconds: 15 * 60,
  key: (req) => req.auth?.id ?? getClientIp(req),
  failClosed: true,
});
