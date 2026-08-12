import { getPool } from '../db/db.js';

/**
 * Generate the next NO-TO record number for a given trip date.
 *
 * The counter is per calendar year, and the year is derived from the trip's
 * date (YYYY-MM-DD) rather than from UTC processing time, so a trip that is
 * synced late still lands in the correct year. Uses MAX of the numeric suffix
 * so gaps from deleted/linked-then-removed records are skipped and we never
 * emit a number that already exists (protecting the unique key on
 * no_to_record_no).
 *
 * The authoritative "0001 = earliest trip date, ascending with dates" ordering
 * is applied afterwards by renumberNoToRecordNos().
 */
export async function generateNoToRecordNo(tripDate: string): Promise<string> {
  const pool = getPool();
  const year = Number(String(tripDate).slice(0, 4));
  const result = await pool.query<{ max_seq: string | null }>(
    `SELECT MAX(CAST(split_part(no_to_record_no, '-', 4) AS INTEGER)) AS max_seq
       FROM gps_no_to_logs
      WHERE EXTRACT(YEAR FROM COALESCE(departure_time, trip_date, created_at)) = $1`,
    [Number.isFinite(year) ? year : new Date().getFullYear()],
  );
  const nextSeq = (Number(result.rows[0]?.max_seq ?? 0)) + 1;
  return `NO-TO-${Number.isFinite(year) ? year : new Date().getFullYear()}-${String(nextSeq).padStart(4, '0')}`;
}

/**
 * Recount every NO-TO record number so that, within each calendar year,
 * numbers ascend strictly by trip date (then created_at, then id) instead of
 * by processing order. Running this keeps the series consistent even when an
 * older-dated trip is synced after a newer-dated one. Only rows whose number
 * actually changes are written. Returns the number of records renumbered.
 */
export async function renumberNoToRecordNos(): Promise<number> {
  const pool = getPool();
  const result = await pool.query<{ rowCount: number }>(
    `WITH ranked AS (
       SELECT g.id,
              EXTRACT(YEAR FROM COALESCE(g.departure_time, g.trip_date, g.created_at))::int AS yr,
              ROW_NUMBER() OVER (
                PARTITION BY EXTRACT(YEAR FROM COALESCE(g.departure_time, g.trip_date, g.created_at))
                ORDER BY g.trip_date ASC, g.created_at ASC, g.id ASC
              ) AS rn
         FROM gps_no_to_logs g
     )
     UPDATE gps_no_to_logs g
        SET no_to_record_no = 'NO-TO-' || r.yr::text || '-' || LPAD(r.rn::text, 4, '0'),
            updated_at = current_timestamp
       FROM ranked r
      WHERE r.id = g.id
        AND g.no_to_record_no IS DISTINCT FROM ('NO-TO-' || r.yr::text || '-' || LPAD(r.rn::text, 4, '0'))`,
  );
  return result.rowCount ?? 0;
}
