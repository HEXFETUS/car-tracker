// ── Supabase / PostgreSQL Alert Persistence ──────────────────
//
// Manages a direct PostgreSQL connection pool and provides
// functions to insert telemetry alert records into the database.
// ALL operations fail gracefully when the DB is not configured.
import pg from 'pg';
import { DATABASE_URL } from './config/env.js';
const { Pool } = pg;
/** Lazy-initialised connection pool (null when not configured). */
let pool = null;
/**
 * Returns `true` when the database client is configured and
 * ready to accept queries.
 */
export function isSupabaseConfigured() {
    return Boolean(DATABASE_URL);
}
/**
 * Lazily initialise the connection pool.
 * Safe to call multiple times — only creates the pool once.
 */
function ensurePool() {
    if (pool)
        return pool;
    if (!isSupabaseConfigured())
        return null;
    pool = new Pool({
        connectionString: DATABASE_URL,
        max: 5,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 10_000,
    });
    pool.on('error', (err) => {
        console.error('Unexpected PostgreSQL pool error:', err.message);
    });
    return pool;
}
/**
 * Normalise a single alert record into a database row.
 */
function mapAlertToRow(alert) {
    return {
        alert_type: alert.type || 'message',
        message: alert.message || '',
        vehicle_id: alert.vehicle_id ?? null,
        location: alert.location ?? null,
        speed: alert.speed ?? null,
        fuel: alert.fuel ?? null,
        created_at: new Date().toISOString(),
    };
}
/**
 * Insert one or more telemetry alerts into the database.
 *
 * @param alerts - Array of alert objects to persist.
 * @returns Result summary with `ok` status and inserted `count`.
 */
export async function insertAlerts(alerts) {
    if (!alerts || alerts.length === 0) {
        return { ok: true, count: 0 };
    }
    const client = ensurePool();
    if (!client) {
        return { ok: false, count: 0, error: 'database_not_configured' };
    }
    try {
        const rows = alerts.map(mapAlertToRow);
        // Build a multi-row INSERT statement
        const columns = Object.keys(rows[0]);
        const placeholders = [];
        const values = [];
        let idx = 1;
        for (const row of rows) {
            const rowPlaceholders = columns.map(() => `$${idx++}`);
            placeholders.push(`(${rowPlaceholders.join(', ')})`);
            for (const col of columns) {
                values.push(row[col]);
            }
        }
        const query = `
      INSERT INTO telemetry_alerts (${columns.map((c) => `"${c}"`).join(', ')})
      VALUES ${placeholders.join(', ')}
    `;
        const result = await client.query(query, values);
        return { ok: true, count: result.rowCount ?? rows.length };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('Supabase insert error:', message);
        return { ok: false, count: 0, error: message };
    }
}
/**
 * Gracefully shut down the connection pool.
 * Call this during application shutdown.
 */
export async function closePool() {
    if (pool) {
        await pool.end().catch(() => { });
        pool = null;
    }
}
//# sourceMappingURL=supabase.js.map