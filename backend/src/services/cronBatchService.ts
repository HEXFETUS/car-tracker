import { getPool } from '../db/db.js';
import {
  runCycle,
  type SchedulerCycleSummary,
} from './scheduler.js';

export interface CronBatchResult {
  summary: SchedulerCycleSummary;
}

export type CronBatchOutcome =
  | { status: 'completed'; httpStatus: 200; reason: null }
  | { status: 'failed'; httpStatus: 500; reason: string };

export function classifyCronBatchResult(result: CronBatchResult): CronBatchOutcome {
  if (result.summary.skipped) {
    return {
      status: 'failed',
      httpStatus: 500,
      reason: result.summary.skipReason || 'scheduler_cycle_skipped',
    };
  }
  return { status: 'completed', httpStatus: 200, reason: null };
}

/**
 * Run one complete fleet telemetry cycle.
 *
 * The external cron intentionally has no fleet cursor, deadline, or advisory
 * lock. Every authorized request processes the complete live fleet and the
 * complete history-alert pass through the existing scheduler rules.
 */
export async function runCronBatch(): Promise<CronBatchResult> {
  const pool = getPool();
  let runId: number | null = null;

  try {
    const runResult = await pool.query<{ id: number }>(
      `INSERT INTO scheduler_runs
         (started_at, status, trigger_source, batch_size)
       VALUES (now(), 'running', 'cron', NULL)
       RETURNING id`,
    );
    runId = runResult.rows[0]?.id ?? null;

    const summary = await runCycle({ allowConcurrent: true });
    const outcome = classifyCronBatchResult({ summary });

    if (runId != null) {
      await pool.query(
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

    return { summary };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (runId != null) {
      await pool.query(
        `UPDATE scheduler_runs
            SET finished_at = now(),
                status = 'error',
                error_message = $2
          WHERE id = $1`,
        [runId, message.slice(0, 2000)],
      ).catch(() => {});
    }
    throw error;
  }
}
