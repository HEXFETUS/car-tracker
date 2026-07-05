// ── Scheduler Run History Service ──────────────────────────────
//
// Provides CRUD operations for the scheduler_runs table.
// This replaces in-memory scheduler state for durable tracking
// across serverless function invocations (cron-job.org).
//
// The most recent run is read by the dashboard to display:
//   - last cron run time
//   - last cron status (success/error)
//   - last error message
//   - cycles completed

import { getPool } from '../db/db.js';

export interface SchedulerRun {
  id: number;
  started_at: string;
  finished_at: string | null;
  status: 'running' | 'success' | 'error';
  cycles_completed: number;
  vehicles_processed: number;
  telemetry_saved: number;
  telegram_sent: number;
  telegram_failed: number;
  skip_reason: string | null;
  error_message: string | null;
  created_at: string;
}

export interface SchedulerRunSummary {
  lastRunAt: string | null;
  lastStatus: 'success' | 'error' | 'running' | null;
  lastErrorMessage: string | null;
  cyclesCompleted: number;
  totalRuns: number;
  totalErrors: number;
}

/**
 * Create a new scheduler run record with 'running' status.
 * Returns the id of the inserted row.
 */
export async function createSchedulerRun(startedAt: string): Promise<number> {
  const pool = getPool();
  const result = await pool.query<{ id: number }>(
    `INSERT INTO scheduler_runs (started_at, status, cycles_completed)
     VALUES ($1, 'running', 0)
     RETURNING id`,
    [startedAt],
  );
  return result.rows[0].id;
}

/**
 * Mark a scheduler run as completed successfully.
 */
export async function completeSchedulerRun(
  id: number,
  finishedAt: string,
  cyclesCompleted: number,
  metrics: {
    vehiclesProcessed: number;
    telemetrySaved: number;
    telegramSent: number;
    telegramFailed: number;
    skipReason?: string | null;
  },
): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE scheduler_runs
     SET status = 'success',
         finished_at = $1,
         cycles_completed = $2,
         vehicles_processed = $3,
         telemetry_saved = $4,
         telegram_sent = $5,
         telegram_failed = $6,
         skip_reason = $7
     WHERE id = $8`,
    [
      finishedAt,
      cyclesCompleted,
      metrics.vehiclesProcessed,
      metrics.telemetrySaved,
      metrics.telegramSent,
      metrics.telegramFailed,
      metrics.skipReason ?? null,
      id,
    ],
  );
}

/**
 * Mark a scheduler run as failed with an error message.
 */
export async function failSchedulerRun(
  id: number,
  finishedAt: string,
  errorMessage: string,
  metrics?: {
    vehiclesProcessed?: number;
    telemetrySaved?: number;
    telegramSent?: number;
    telegramFailed?: number;
    skipReason?: string | null;
  },
): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE scheduler_runs
     SET status = 'error',
         finished_at = $1,
         error_message = $2,
         vehicles_processed = COALESCE($3, vehicles_processed),
         telemetry_saved = COALESCE($4, telemetry_saved),
         telegram_sent = COALESCE($5, telegram_sent),
         telegram_failed = COALESCE($6, telegram_failed),
         skip_reason = COALESCE($7, skip_reason)
     WHERE id = $8`,
    [
      finishedAt,
      errorMessage,
      metrics?.vehiclesProcessed ?? null,
      metrics?.telemetrySaved ?? null,
      metrics?.telegramSent ?? null,
      metrics?.telegramFailed ?? null,
      metrics?.skipReason ?? null,
      id,
    ],
  );
}

/**
 * Get the latest N scheduler runs.
 */
export async function getRecentSchedulerRuns(limit = 10): Promise<SchedulerRun[]> {
  const pool = getPool();
  const result = await pool.query<SchedulerRun>(
    `SELECT id, started_at, finished_at, status, cycles_completed,
            vehicles_processed, telemetry_saved, telegram_sent, telegram_failed, skip_reason,
            error_message, created_at
     FROM scheduler_runs
     ORDER BY started_at DESC
     LIMIT $1`,
    [limit],
  );
  return result.rows;
}

/**
 * Get a summary of scheduler run statistics.
 * Reads the latest run and aggregates totals.
 */
export async function getSchedulerRunSummary(): Promise<SchedulerRunSummary> {
  const pool = getPool();

  // Get the latest run
  const latestResult = await pool.query<SchedulerRun>(
    `SELECT id, started_at, finished_at, status, cycles_completed,
            vehicles_processed, telemetry_saved, telegram_sent, telegram_failed, skip_reason,
            error_message, created_at
     FROM scheduler_runs
     ORDER BY started_at DESC
     LIMIT 1`,
  );

  // Get aggregate stats
  const statsResult = await pool.query<{
    total_runs: string;
    total_errors: string;
    total_cycles: string;
  }>(
    `SELECT
       COUNT(*)::text AS total_runs,
       COUNT(*) FILTER (WHERE status = 'error')::text AS total_errors,
       COALESCE(SUM(cycles_completed), 0)::text AS total_cycles
     FROM scheduler_runs`,
  );

  const latest = latestResult.rows[0] ?? null;
  const stats = statsResult.rows[0] ?? { total_runs: '0', total_errors: '0', total_cycles: '0' };

  return {
    lastRunAt: latest?.started_at ?? null,
    lastStatus: (latest?.status as 'success' | 'error' | 'running') ?? null,
    lastErrorMessage: latest?.error_message ?? null,
    cyclesCompleted: parseInt(stats.total_cycles, 10),
    totalRuns: parseInt(stats.total_runs, 10),
    totalErrors: parseInt(stats.total_errors, 10),
  };
}

/**
 * Clean up old scheduler run records, keeping only the last 1000.
 */
export async function cleanupOldSchedulerRuns(): Promise<number> {
  const pool = getPool();
  const result = await pool.query(
    `DELETE FROM scheduler_runs
     WHERE id NOT IN (
       SELECT id FROM scheduler_runs
       ORDER BY started_at DESC
       LIMIT 1000
     )`,
  );
  return result.rowCount ?? 0;
}
