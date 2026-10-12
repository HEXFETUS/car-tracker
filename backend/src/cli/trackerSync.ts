import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import type { SchedulerCycleSummary } from '../services/scheduler.js';

interface CliDependencies {
  runCycle: () => Promise<SchedulerCycleSummary>;
  closePool: () => Promise<void>;
  closeTrackerDatabase: () => Promise<void>;
}

/** Load configuration before importing backend modules; do not start Express. */
export async function runTrackerCli(dependencies?: CliDependencies): Promise<void> {
  if (!dependencies) {
    dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });
    const { runCycle } = await import('../services/scheduler.js');
    const { closePool } = await import('../db/db.js');
    const { closeTrackerDatabase } = await import('@car-tracker/tracker');
    dependencies = { runCycle, closePool, closeTrackerDatabase };
  }
  const { runCycle, closePool, closeTrackerDatabase } = dependencies;
  try {
    const summary = await runCycle();
    console.log(JSON.stringify(summary, null, 2));
    if (summary.skipped || summary.telemetryFailed > 0 || summary.telegramFailed > 0) process.exitCode = 1;
  } catch {
    console.error('[tracker-cli] Backend synchronization failed');
    process.exitCode = 1;
  } finally { await Promise.all([closePool(), closeTrackerDatabase()]); }
}
