// ── PostgreSQL Connection Pool Singleton ─────────────────────
//
// Single shared pool instance used by all route handlers.
// Lazily initialised from DATABASE_URL.

import pg from 'pg';
import { DATABASE_URL } from '../config/env.js';

const { Pool } = pg;

let pool: pg.Pool | null = null;

/**
 * Return the shared application pool.
 * Creates it lazily on first call.
 */
export function getPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: DATABASE_URL,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });

    pool.on('error', (err: Error) => {
      console.error('Unexpected PostgreSQL pool error:', err.message);
    });
  }
  return pool;
}

/**
 * Gracefully shut down the pool (call during app shutdown).
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end().catch(() => {});
    pool = null;
  }
}