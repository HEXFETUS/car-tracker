#!/usr/bin/env node

// ── Tracker Sync Runner ───────────────────────────────────────
//
// Entry-point script for the fleet tracking sync cycle.
// Invokes syncFleetAndAlert() once and writes structured
// telemetry statistics to stdout.
//
// External Invocation (cron / scheduled task):
//   ┌─────────────────────────────────────────────────────────
//   │  # Run every 5 minutes via system crontab:
//   │  */5 * * * * cd /path/to/monorepo && pnpm --filter @car-tracker/tracker start
//   │
//   │  # Or via cron-job.org / webhook endpoint:
//   │  # Point a webhook or scheduled job to trigger this CLI
//   │  # on your desired interval (e.g. every 5 minutes).
//   │  # The script will exit cleanly after one sync cycle.
//   └─────────────────────────────────────────────────────────
//
// Environment:
//   All configuration is read from process.env (see tracker.js
//   for the full list of required/optional env vars).

import { syncFleetAndAlert } from './tracker.js';

async function main() {
  const startTime = Date.now();

  try {
    const result = await syncFleetAndAlert();

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    const alerts = result.alerts;

    // Structured telemetry summary written to stdout
    const summary = {
      status: result.status,
      elapsed_seconds: parseFloat(elapsed),
      total_active_units: result.vehicles,
      alerts: {
        queued: alerts.queued,
        sent: alerts.sent,
        skipped: alerts.skipped,
        failed: alerts.failed,
        persisted: alerts.persisted,
      },
      timestamp: new Date().toISOString(),
    };

    console.log(JSON.stringify(summary, null, 2));

    // Non-zero exit if any alerts failed to send
    if (alerts.failed > 0) {
      process.exitCode = 1;
    }
  } catch (error) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

    console.error(
      JSON.stringify(
        {
          status: 'error',
          elapsed_seconds: parseFloat(elapsed),
          error: error.message,
          timestamp: new Date().toISOString(),
        },
        null,
        2,
      ),
    );

    process.exitCode = 1;
  }
}

main();