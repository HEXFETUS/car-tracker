// ── Cron / Scheduled Sync Endpoint ────────────────────────────
//
// GET /api/cron/sync-tracker
//
// Protected endpoint that triggers one fleet telemetry sync cycle.
// Authentication is performed by matching the X-Cron-Secret header
// (or ?secret= query parameter, or Authorization: Bearer header)
// against the CRON_SECRET env variable.
//
// Usage (external cron service — e.g. cron-job.org):
//   GET https://your-api.example.com/api/cron/sync-tracker?secret=your-cron-secret-here

import express, { type Request, type Response, type Router as ExpressRouter } from 'express';
import { CRON_SECRET } from '../config/env.js';
import { classifyCronBatchResult, runCronBatch } from '../services/cronBatchService.js';

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
 * Returns a JSON summary of what happened.
 */
router.get('/sync-tracker', async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!isAuthorized(req)) {
    res.status(401).json({
      success: false,
      error: 'Unauthorized — missing or invalid cron secret',
    });
    return;
  }

  const startTime = Date.now();

  try {
    const batchResult = await runCronBatch();
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    const outcome = classifyCronBatchResult(batchResult);

    res.status(outcome.httpStatus).json({
      success: outcome.status === 'completed',
      status: outcome.status,
      reason: outcome.reason,
      elapsed_seconds: parseFloat(elapsed),
      totals: {
        vehicles_processed: batchResult.summary.vehiclesProcessed,
        telemetry_saved: batchResult.summary.telemetrySaved,
        telemetry_skipped: batchResult.summary.telemetrySkipped,
        telemetry_failed: batchResult.summary.telemetryFailed,
        telegram_sent: batchResult.summary.telegramSent,
        telegram_failed: batchResult.summary.telegramFailed,
        history_alerts: batchResult.summary.historyAlerts ?? null,
      },
    });
  } catch (error) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    const message = error instanceof Error ? error.message : String(error);

    console.error('Cron sync error:', message);

    res.status(500).json({
      success: false,
      error: message,
      elapsed_seconds: parseFloat(elapsed),
    });
  }
});

export default router;
