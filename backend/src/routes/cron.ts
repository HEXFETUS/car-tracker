// ── Cron / Scheduled Sync Endpoint ────────────────────────────
//
// GET /api/cron/sync-tracker
//
// Protected endpoint that triggers one fleet telemetry sync cycle.
// Authentication is performed by matching the X-Cron-Secret header
// (or ?secret= query parameter) against the CRON_SECRET env variable.
//
// Usage (external cron service — e.g. cron-job.org):
//   GET https://your-api.example.com/api/cron/sync-tracker
//   Headers: { "X-Cron-Secret": "your-cron-secret-here" }

import { Router, Request, Response } from 'express';
import { CRON_SECRET } from '../config/env.js';
import { syncFleetAndAlert } from '@car-tracker/tracker';

const router: Router = Router();

/**
 * Validate the cron request by checking the secret.
 * Accepts the secret via:
 *   - X-Cron-Secret header
 *   - ?secret= query parameter
 */
function isAuthorized(req: Request): boolean {
  if (!CRON_SECRET) return false;
  const headerSecret = req.headers['x-cron-secret'] as string | undefined;
  if (headerSecret === CRON_SECRET) return true;
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
  if (!isAuthorized(req)) {
    res.status(401).json({
      success: false,
      error: 'Unauthorized — missing or invalid cron secret',
    });
    return;
  }

  const startTime = Date.now();

  try {
    const result = await syncFleetAndAlert();

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

    res.json({
      success: true,
      elapsed_seconds: parseFloat(elapsed),
      total_active_units: result.vehicles,
      alerts_dispatched: result.alerts.sent,
      alerts_skipped: result.alerts.skipped,
      alerts_failed: result.alerts.failed,
      alerts_persisted: result.alerts.persisted,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    const message = error instanceof Error ? error.message : String(error);

    console.error('Cron sync error:', message);

    res.status(500).json({
      success: false,
      error: message,
      elapsed_seconds: parseFloat(elapsed),
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;