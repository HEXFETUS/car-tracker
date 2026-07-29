import type pg from 'pg';
import { getPool } from '../db/db.js';
import {
  runCycle,
  type SchedulerCycleSummary,
} from './scheduler.js';

export interface CronBatchResult {
  locked: boolean;
  summary: SchedulerCycleSummary | null;
}

export type CronBatchOutcome =
  | { status: 'completed'; httpStatus: 200; reason: null }
  | { status: 'already_running'; httpStatus: 409; reason: 'advisory_lock_active' }
  | { status: 'failed'; httpStatus: 500; reason: string };

export function classifyCronBatchResult(result: CronBatchResult): CronBatchOutcome {
  if (!result.locked) {
    return {
      status: 'already_running',
      httpStatus: 409,
      reason: 'advisory_lock_active',
    };
  }
  if (!result.summary) {
    return {
      status: 'failed',
      httpStatus: 500,
      reason: 'missing_cycle_summary',
    };
  }
  if (result.summary.skipped) {
    return {
      status: 'failed',
      httpStatus: 500,
      reason: result.summary.skipReason || 'scheduler_cycle_skipped',
    };
  }
  return { status: 'completed', httpStatus: 200, reason: null };
}

const ADVISORY_LOCK_NAME = 'car-tracker:fleet-telemetry-cron';

async function tryAcquireLock(client: pg.PoolClient): Promise<boolean> {
  const result = await client.query<{ acquired: boolean }>(
    'SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',
    [ADVISORY_LOCK_NAME],
  );
  return result.rows[0]?.acquired === true;
}

/**
 * Run one complete fleet telemetry cycle.
 *
 * Every authorized request processes the complete live fleet and history-alert
 * pass. A session advisory lock prevents two full-fleet cron runs from
 * overlapping without reintroducing fleet batching or a cursor.
 */
export async function runCronBatch(): Promise<CronBatchResult> {
  const pool = getPool();
  const client = await pool.connect();
  let locked = false;
  let runId: number | null = null;

  try {
    locked = await tryAcquireLock(client);
    if (!locked) {
      return { locked: false, summary: null };
    }

    const runResult = await client.query<{ id: number }>(
      `INSERT INTO scheduler_runs
         (started_at, status, trigger_source, batch_size)
       VALUES (now(), 'running', 'cron', NULL)
       RETURNING id`,
    );
    runId = runResult.rows[0]?.id ?? null;

    const summary = await runCycle({ allowConcurrent: true });
    const outcome = classifyCronBatchResult({ locked: true, summary });

    if (runId != null) {
      await client.query(
        `UPDATE scheduler_runs
            SET finished_at = now(),
                status = $2,
                cycles_completed = CASE WHEN $2 = 'completed' THEN 1 ELSE 0 END,
                vehicles_processed = $3,
                telemetry_saved = $4,
                telegram_sent = $5,
                telegram_failed = $6,
                skip_reason = $7,
                rows_examined = $8,
                batch_offset = NULL
          WHERE id = $1`,
        [
          runId,
          outcome.status,
          summary.vehiclesProcessed,
          summary.telemetrySaved,
          summary.telegramSent,
          summary.telegramFailed,
          outcome.reason,
          summary.lifecycleRowsExamined ?? 0,
        ],
      );
    }

    return { locked: true, summary };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (runId != null) {
      await client.query(
        `UPDATE scheduler_runs
            SET finished_at = now(),
                status = 'error',
                error_message = $2
          WHERE id = $1`,
        [runId, message.slice(0, 2000)],
      ).catch(() => {});
    }
    throw error;
  } finally {
    if (locked) {
      await client.query(
        'SELECT pg_advisory_unlock(hashtext($1))',
        [ADVISORY_LOCK_NAME],
      ).catch(() => {});
    }
    client.release();
  }
}
