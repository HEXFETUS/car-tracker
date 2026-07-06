// ── PostgreSQL Connection Pool Singleton ─────────────────────
//
// Single shared pool instance used by all route handlers.
// Lazily initialised from DATABASE_URL.

import pg from 'pg';
import { DATABASE_URL } from '../config/env.js';

const { Pool } = pg;

/**
 * OID for `timestamp without time zone`.
 * pg's default parser converts this to a Date object by interpreting
 * the raw DB value as UTC, which breaks when the column stores
 * Asia/Manila wall-clock time (see migration 028).
 *
 * We override the parser so the raw ISO string is preserved and
 * suffixed with the +08:00 offset, ensuring the frontend always
 * receives the correct local time.
 */
const TIMESTAMP_OID = 1114;

pg.types.setTypeParser(TIMESTAMP_OID, (val: string) => {
  if (!val) return null;
  // Append +08:00 to the raw timestamp so it's treated as Asia/Manila local time
  return val + '+08:00';
});

let pool: pg.Pool | null = null;
let loggedDatabaseTarget = false;

function getSafeDatabaseTarget(connectionString: string): string {
  if (!connectionString) return 'DATABASE_URL is not set';
  try {
    const parsed = new URL(connectionString);
    return `host=${parsed.hostname || 'unknown'} port=${parsed.port || 'default'} database=${parsed.pathname.replace(/^\//, '') || 'unknown'}`;
  } catch {
    return 'DATABASE_URL is set but could not be parsed';
  }
}

/**
 * Return the shared application pool.
 * Creates it lazily on first call.
 */
export function getPool(): pg.Pool {
  if (!pool) {
    if (!loggedDatabaseTarget) {
      console.log(`[db] PostgreSQL target: ${getSafeDatabaseTarget(DATABASE_URL)}`);
      loggedDatabaseTarget = true;
    }

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

export function setPoolForTest(testPool: pg.Pool | null): void {
  pool = testPool;
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
