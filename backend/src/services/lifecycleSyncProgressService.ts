import type pg from 'pg';

export interface LifecycleSyncOptions {
  fullHistory?: boolean;
  lateArrivalOverlapMinutes?: number;
}

export async function beginLifecycleSync(
  client: pg.Pool,
  jobName: string,
  options: LifecycleSyncOptions,
): Promise<Date | null> {
  if (options.fullHistory) return null;

  const result = await client.query<{ last_created_at: Date | string | null }>(
    `INSERT INTO lifecycle_sync_progress (job_name, last_started_at, last_result, updated_at)
     VALUES ($1, now(), 'running', now())
     ON CONFLICT (job_name) DO UPDATE SET
       last_started_at = now(),
       last_result = 'running',
       last_error = NULL,
       updated_at = now()
     RETURNING last_created_at`,
    [jobName],
  );
  const watermark = result.rows[0]?.last_created_at;
  if (!watermark) return new Date(0);

  const overlapMs = Math.max(0, options.lateArrivalOverlapMinutes ?? 15) * 60_000;
  return new Date(new Date(watermark).getTime() - overlapMs);
}

export async function completeLifecycleSync(
  client: pg.Pool,
  jobName: string,
  rowsExamined: number,
  maxCreatedAt: Date | string | null,
  fullHistory: boolean,
): Promise<void> {
  if (fullHistory) return;
  await client.query(
    `UPDATE lifecycle_sync_progress
        SET last_created_at = GREATEST(
              COALESCE(last_created_at, '-infinity'::timestamptz),
              COALESCE($2::timestamptz, last_created_at, '-infinity'::timestamptz)
            ),
            last_completed_at = now(),
            last_rows_examined = $3,
            last_result = 'completed',
            last_error = NULL,
            updated_at = now()
      WHERE job_name = $1`,
    [jobName, maxCreatedAt, rowsExamined],
  );
}

export async function failLifecycleSync(
  client: pg.Pool,
  jobName: string,
  error: unknown,
  fullHistory: boolean,
): Promise<void> {
  if (fullHistory) return;
  const message = error instanceof Error ? error.message : String(error);
  await client.query(
    `UPDATE lifecycle_sync_progress
        SET last_result = 'failed',
            last_error = $2,
            updated_at = now()
      WHERE job_name = $1`,
    [jobName, message.slice(0, 2000)],
  ).catch(() => {});
}
