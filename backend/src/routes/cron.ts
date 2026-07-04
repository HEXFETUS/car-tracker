// ── Cron / Scheduled Sync Endpoint ────────────────────────────
//
// GET /api/cron/sync-tracker
//
// Protected endpoint that triggers one fleet telemetry sync cycle.
// Authentication is performed by matching the X-Cron-Secret header
// (or ?secret= query parameter, or Authorization: Bearer header)
// against the CRON_SECRET env variable.
//
// This endpoint persists run history to the scheduler_runs table
// for durable status tracking across serverless function invocations.
//
// Usage (external cron service — e.g. cron-job.org):
//   GET https://your-api.example.com/api/cron/sync-tracker?secret=your-cron-secret-here

import express, { type Request, type Response, type Router as ExpressRouter } from 'express';
import { CRON_SECRET } from '../config/env.js';
import { runCycle } from '../services/scheduler.js';
import {
  createSchedulerRun,
  completeSchedulerRun,
  failSchedulerRun,
} from '../services/schedulerRunService.js';

const router: ExpressRouter = express.Router();

/**
 * Validate the cron request by checking the secret.
 * Accepts the secret via:
 *   - X-Cron-Secret header
 *   - Authorization: Bearer <secret>
 *   - ?secret= query parameter
 */
function isAuthorized(req: Request): boolean {
  if (!CRON_SECRET) return false;

  // Check X-Cron-Secret header
  const headerSecret = req.headers['x-cron-secret'] as string | undefined;
  if (headerSecret === CRON_SECRET) return true;

  // Check Authorization: Bearer header
  const authHeader = req.headers['authorization'] as string | undefined;
  if (authHeader) {
    const parts = authHeader.split(' ');
    if (parts.length === 2 && parts[0].toLowerCase() === 'bearer' && parts[1] === CRON_SECRET) {
      return true;
    }
  }

  // Check ?secret= query parameter
  const querySecret = req.query.secret as string | undefined;
  if (querySecret === CRON_SECRET) return true;

  return false;
}

/**
 * GET /api/cron/sync-tracker
 *
 * Triggers a single fleet sync & alert cycle.
 * Persists run history to scheduler_runs table.
 * Returns a JSON summary of what happened.
 */
router.get('/sync-tracker', async (req: Request, res: Response) => {
  if (!isAuthorized(req)) {
    res.status(401).json({
      success: false,
      error: 'Unauthorized — missing or invalid cron secret',
    });
    return;
  }

  const startTime = Date.now();
  const startedAt = new Date(startTime).toISOString();

  // Create a run record in the database
  let runId: number | null = null;
  try {
    runId = await createSchedulerRun(startedAt);
  } catch (dbError) {
    console.error('Cron sync: failed to create scheduler run record:', (dbError as Error).message);
    // Continue even if DB logging fails — the sync itself is more important
  }

  try {
    // Execute one full scheduler cycle
    await runCycle();

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    const finishedAt = new Date().toISOString();

    // Mark the run as successful in the database
    if (runId !== null) {
      try {
        await completeSchedulerRun(runId, finishedAt, 1);
      } catch (dbError) {
        console.error('Cron sync: failed to update scheduler run record:', (dbError as Error).message);
      }
    }

    res.json({
      success: true,
      elapsed_seconds: parseFloat(elapsed),
    });
  } catch (error) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    const message = error instanceof Error ? error.message : String(error);
    const finishedAt = new Date().toISOString();

    console.error('Cron sync error:', message);

    // Mark the run as failed in the database
    if (runId !== null) {
      try {
        await failSchedulerRun(runId, finishedAt, message);
      } catch (dbError) {
        console.error('Cron sync: failed to mark scheduler run as failed:', (dbError as Error).message);
      }
    }

    res.status(500).json({
      success: false,
      error: message,
      elapsed_seconds: parseFloat(elapsed),
    });
  }
});

export default router;