import type { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { getPool } from '../db/db.js';

// Key 0 coordinates renumbering; keys 1..9999 protect numbering years.
const LOCK_NAMESPACE = 730001;

export function noToYear(tripDate: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tripDate)) throw new Error('Invalid No-TO trip_date');
  const parsed = new Date(`${tripDate}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== tripDate
      || parsed.getUTCFullYear() < 1) throw new Error('Invalid No-TO trip_date');
  return parsed.getUTCFullYear();
}

export async function lockNoToWriters(client: PoolClient): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock_shared($1::int, 0)', [LOCK_NAMESPACE]);
}

export async function lockNoToYear(client: PoolClient, year: number): Promise<void> {
  if (!Number.isInteger(year) || year < 1 || year > 9999) throw new Error('Invalid No-TO year');
  // Writers take the shared gate first. Exclusive renumbering freezes the year set.
  await lockNoToWriters(client);
  await client.query('SELECT pg_advisory_xact_lock($1::int, $2::int)', [LOCK_NAMESPACE, year]);
}

/** Allocate only through the caller's locked transaction, never pool.query(). */
export async function generateNoToRecordNo(tripDate: string, client?: PoolClient): Promise<string> {
  const year = noToYear(tripDate);
  if (!client) throw new Error('No-TO allocation requires a locked transaction client');
  const result = await client.query<{ max_seq: string | null }>(
    `SELECT MAX(split_part(no_to_record_no, '-', 4)::numeric)::text AS max_seq
       FROM gps_no_to_logs WHERE no_to_record_no ~ $1`,
    [`^NO-TO-${String(year).padStart(4, '0')}-[0-9]+$`],
  );
  // Account for old numbers whose prefixes disagree with their trip dates.
  const sequence = BigInt(result.rows[0]?.max_seq ?? '0') + 1n;
  return `NO-TO-${String(year).padStart(4, '0')}-${String(sequence).padStart(4, '0')}`;
}

/** Atomic chronological numbering; preserve rows and the unique constraint. */
export async function renumberNoToRecordNos(): Promise<number> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1::int, 0)', [LOCK_NAMESPACE]);
    const result = await client.query<{ id: string; trip_date: string; no_to_record_no: string }>(
      `SELECT id, trip_date::text, no_to_record_no FROM gps_no_to_logs
        ORDER BY trip_date ASC, created_at ASC, id ASC FOR UPDATE`,
    );
    const years = [...new Set(result.rows.map(row => noToYear(row.trip_date)))].sort((a, b) => a - b);
    for (const year of years) {
      await client.query('SELECT pg_advisory_xact_lock($1::int, $2::int)', [LOCK_NAMESPACE, year]);
    }
    const counters = new Map<number, bigint>();
    const changes = result.rows.flatMap(row => {
      const year = noToYear(row.trip_date);
      const sequence = (counters.get(year) ?? 0n) + 1n;
      counters.set(year, sequence);
      const final = `NO-TO-${String(year).padStart(4, '0')}-${String(sequence).padStart(4, '0')}`;
      return final === row.no_to_record_no ? [] : [{ id: row.id, final }];
    });
    if (changes.length) {
      const ids = changes.map(row => row.id);
      let temporary: string[];
      for (;;) {
        const prefix = `__NO_TO_${randomUUID()}_`;
        temporary = ids.map((_, index) => `${prefix}${index}`);
        const collisions = await client.query(
          'SELECT 1 FROM gps_no_to_logs WHERE no_to_record_no = ANY($1::text[]) LIMIT 1', [temporary],
        );
        if (!collisions.rows.length) break;
      }
      const update = `UPDATE gps_no_to_logs g
        SET no_to_record_no = replacement.number, updated_at = current_timestamp
        FROM unnest($1::uuid[], $2::text[]) AS replacement(id, number)
        WHERE g.id = replacement.id`;
      await client.query(update, [ids, temporary]);
      await client.query(update, [ids, changes.map(row => row.final)]);
    }
    await client.query('COMMIT');
    return changes.length;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* Preserve the original error. */ }
    throw error;
  } finally {
    client.release();
  }
}
