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
          SET last_started_at = now(), updated_at = now()
        WHERE scheduler_name = $1`,
      [SCHEDULER_NAME],
    );

    const summary = await runCycle({
      batchOffset: progress.next_vehicle_offset,
      batchLimit: CRON_BATCH_SIZE,
      deadlineAtMs,
    });
    const next = nextCronProgress(fleetPass, progress.next_vehicle_offset, summary);

    await client.query(
      `UPDATE cron_scheduler_progress
          SET next_vehicle_offset = $2,
              fleet_pass = $3,
              last_completed_at = now(),
              updated_at = now()
        WHERE scheduler_name = $1`,
      [SCHEDULER_NAME, next.nextVehicleOffset, next.nextFleetPass],
    );

    return {
      locked: true,
      batchSize: CRON_BATCH_SIZE,
      softDeadlineMs: CRON_SOFT_DEADLINE_MS,
      fleetPass,
      nextFleetPass: next.nextFleetPass,
      summary,
    };
  } finally {
    if (locked) {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [ADVISORY_LOCK_NAME]).catch(() => {});
    }
    client.release();
  }
}
