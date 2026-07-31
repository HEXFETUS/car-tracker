import type pg from 'pg';
import { getPool } from '../db/db.js';
import { CRON_BATCH_SIZE, CRON_SOFT_DEADLINE_MS } from '../config/env.js';
import { runCycle, type SchedulerCycleSummary } from './scheduler.js';

const SCHEDULER_NAME = 'fleet-telemetry';
const ADVISORY_LOCK_NAME = 'car-tracker:fleet-telemetry-cron';

interface ProgressRow {
  next_vehicle_offset: number;
  fleet_pass: string | number;
}

export interface CronBatchResult {
  locked: boolean;
  batchSize: number;
  softDeadlineMs: number;
  fleetPass: number | null;
  nextFleetPass: number | null;
  summary: SchedulerCycleSummary | null;
}

export type CronBatchOutcome =
  | { status: 'completed'; httpStatus: 200; reason: null }
  | { status: 'already_running'; httpStatus: 200; reason: 'advisory_lock_active' }
  | { status: 'failed'; httpStatus: 500; reason: string };

export function classifyCronBatchResult(result: CronBatchResult): CronBatchOutcome {
  if (!result.locked) {
    return { status: 'already_running', httpStatus: 200, reason: 'advisory_lock_active' };
  }
  if (!result.summary) {
    return { status: 'failed', httpStatus: 500, reason: 'missing_cycle_summary' };
  }
  if (result.summary.skipped) {
    return {
      status: 'failed',
      httpStatus: 500,
      reason: result.summary.skipReason || 'scheduler_cycle_skipped',
    };
  }
  if (
    !result.summary.batch
    || (result.summary.batch.examined === 0 && !result.summary.batch.passComplete)
  ) {
    return { status: 'failed', httpStatus: 500, reason: 'no_batch_progress' };
  }
  return { status: 'completed', httpStatus: 200, reason: null };
}

export function nextCronProgress(
  currentFleetPass: number,
  currentVehicleOffset: number,
  summary: SchedulerCycleSummary,
): { nextVehicleOffset: number; nextFleetPass: number } {
  if (summary.skipped || !summary.batch) {
    return { nextVehicleOffset: currentVehicleOffset, nextFleetPass: currentFleetPass };
  }
  return {
    nextVehicleOffset: summary.batch.nextOffset,
    nextFleetPass: summary.batch.passComplete ? currentFleetPass + 1 : currentFleetPass,
  };
}

async function ensureProgressSchema(client: pg.PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS cron_scheduler_progress (
      scheduler_name TEXT PRIMARY KEY,
      next_vehicle_offset INTEGER NOT NULL DEFAULT 0 CHECK (next_vehicle_offset >= 0),
      fleet_pass BIGINT NOT NULL DEFAULT 1 CHECK (fleet_pass >= 1),
      last_started_at TIMESTAMPTZ,
      last_completed_at TIMESTAMPTZ,
      last_attempt_at TIMESTAMPTZ,
      last_result TEXT,
      last_skip_reason TEXT,
      last_error TEXT,
      last_batch_offset INTEGER,
      last_vehicles_examined INTEGER,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await client.query(`
    ALTER TABLE cron_scheduler_progress
      ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS last_result TEXT,
      ADD COLUMN IF NOT EXISTS last_skip_reason TEXT,
      ADD COLUMN IF NOT EXISTS last_error TEXT,
      ADD COLUMN IF NOT EXISTS last_batch_offset INTEGER,
      ADD COLUMN IF NOT EXISTS last_vehicles_examined INTEGER
  `);
  await client.query(`
    INSERT INTO cron_scheduler_progress (scheduler_name)
    VALUES ($1)
    ON CONFLICT (scheduler_name) DO NOTHING
  `, [SCHEDULER_NAME]);
}

async function tryAcquireLock(client: pg.PoolClient): Promise<boolean> {
  const result = await client.query<{ acquired: boolean }>(
    'SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',
    [ADVISORY_LOCK_NAME],
  );
  return result.rows[0]?.acquired === true;
}

export async function runCronBatch(): Promise<CronBatchResult> {
  const client = await getPool().connect();
  let locked = false;
  let runId: number | null = null;

  try {
    await ensureProgressSchema(client);
    locked = await tryAcquireLock(client);
    if (!locked) {
      await client.query(
        `UPDATE cron_scheduler_progress
            SET last_attempt_at = now(),
                last_result = 'already_running',
                last_skip_reason = 'advisory_lock_active',
                updated_at = now()
          WHERE scheduler_name = $1`,
        [SCHEDULER_NAME],
      );
      return {
        locked: false,
        batchSize: CRON_BATCH_SIZE,
        softDeadlineMs: CRON_SOFT_DEADLINE_MS,
        fleetPass: null,
        nextFleetPass: null,
        summary: null,
      };
    }

    const progressResult = await client.query<ProgressRow>(
      `SELECT next_vehicle_offset, fleet_pass
         FROM cron_scheduler_progress
        WHERE scheduler_name = $1`,
      [SCHEDULER_NAME],
    );
    const progress = progressResult.rows[0];
    if (!progress) throw new Error('Cron scheduler progress row is missing');

    const fleetPass = Number(progress.fleet_pass);
    const deadlineAtMs = Date.now() + CRON_SOFT_DEADLINE_MS;
    const runResult = await client.query<{ id: number }>(
      `INSERT INTO scheduler_runs
         (started_at, status, trigger_source, batch_size)
       VALUES (now(), 'running', 'cron', $1)
       RETURNING id`,
      [CRON_BATCH_SIZE],
    );
    runId = runResult.rows[0]?.id ?? null;

    await client.query(
      `UPDATE cron_scheduler_progress
          SET last_attempt_at = now(),
              last_started_at = now(),
              last_result = 'running',
              last_skip_reason = NULL,
              last_error = NULL,
              last_batch_offset = $2,
              last_vehicles_examined = NULL,
              updated_at = now()
        WHERE scheduler_name = $1`,
      [SCHEDULER_NAME, progress.next_vehicle_offset],
    );

    const summary = await runCycle({
      batchOffset: progress.next_vehicle_offset,
      batchLimit: CRON_BATCH_SIZE,
      deadlineAtMs,
    });
    const next = nextCronProgress(fleetPass, progress.next_vehicle_offset, summary);
    const outcome = classifyCronBatchResult({
      locked: true,
      batchSize: CRON_BATCH_SIZE,
      softDeadlineMs: CRON_SOFT_DEADLINE_MS,
      fleetPass,
      nextFleetPass: next.nextFleetPass,
      summary,
    });

    await client.query(
      `UPDATE cron_scheduler_progress
          SET next_vehicle_offset = $2,
              fleet_pass = $3,
              last_completed_at = CASE WHEN $4 = 'completed' THEN now() ELSE last_completed_at END,
              last_result = $4,
              last_skip_reason = $5,
              last_vehicles_examined = $6,
              updated_at = now()
        WHERE scheduler_name = $1`,
      [
        SCHEDULER_NAME,
        next.nextVehicleOffset,
        next.nextFleetPass,
        outcome.status,
        outcome.reason,
        summary.batch?.examined ?? 0,
      ],
    );

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
                batch_offset = $9
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
          progress.next_vehicle_offset,
        ],
      );
    }

    return {
      locked: true,
      batchSize: CRON_BATCH_SIZE,
      softDeadlineMs: CRON_SOFT_DEADLINE_MS,
      fleetPass,
      nextFleetPass: next.nextFleetPass,
      summary,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await client.query(
      `UPDATE cron_scheduler_progress
          SET last_result = 'failed',
              last_skip_reason = NULL,
              last_error = $2,
              updated_at = now()
        WHERE scheduler_name = $1`,
      [SCHEDULER_NAME, message.slice(0, 2000)],
    ).catch(() => {});
    if (runId != null) {
      await client.query(
        `UPDATE scheduler_runs
            SET finished_at = now(), status = 'error', error_message = $2
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
