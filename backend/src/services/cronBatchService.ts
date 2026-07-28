import type pg from 'pg';
import { getPool } from '../db/db.js';
import { CRON_BATCH_SIZE, CRON_SOFT_DEADLINE_MS } from '../config/env.js';
import {
  runCycle,
  type SchedulerCycleSummary,
} from './scheduler.js';

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
  | { status: 'lock_active'; httpStatus: 409; reason: 'advisory_lock_active' | 'cycle_lock_active' }
  | { status: 'skipped'; httpStatus: 503; reason: string }
  | { status: 'no_progress'; httpStatus: 503; reason: 'no_batch_progress' };

export function classifyCronBatchResult(result: CronBatchResult): CronBatchOutcome {
  if (!result.locked) {
    return { status: 'lock_active', httpStatus: 409, reason: 'advisory_lock_active' };
  }
  if (!result.summary) {
    return { status: 'skipped', httpStatus: 503, reason: 'missing_cycle_summary' };
  }
  if (result.summary.skipped) {
    const reason = result.summary.skipReason || 'scheduler_cycle_skipped';
    if (reason === 'lock_active') {
      return { status: 'lock_active', httpStatus: 409, reason: 'cycle_lock_active' };
    }
    return { status: 'skipped', httpStatus: 503, reason };
  }
  if (
    !result.summary.batch
    || (result.summary.batch.examined === 0 && !result.summary.batch.passComplete)
  ) {
    return { status: 'no_progress', httpStatus: 503, reason: 'no_batch_progress' };
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

  try {
    locked = await tryAcquireLock(client);
    if (!locked) {
      await client.query(
        `UPDATE cron_scheduler_progress
            SET last_attempt_at = now(),
                last_result = 'lock_active',
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
    if (progressResult.rowCount !== 1) {
      throw new Error('Cron scheduler progress is missing; apply migration 083');
    }

    const progress = progressResult.rows[0];
    const fleetPass = Number(progress.fleet_pass);
    const deadlineAtMs = Date.now() + CRON_SOFT_DEADLINE_MS;

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
    throw error;
  } finally {
    if (locked) {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [ADVISORY_LOCK_NAME]).catch(() => {});
    }
    client.release();
  }
}
