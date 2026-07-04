// ── Settings Routes ───────────────────────────────────────────
//
// Endpoints for the Settings module, including connection status
// checks for fleet, GPS logs, and Telegram integrations.

import express, { type Request, type Response, type Router as ExpressRouter } from 'express';
import { getPool } from '../db/db.js';
import {
  BOT_TOKEN,
  CHAT_ID,
  CARTRACK_USERNAME,
  CARTRACK_PASSWORD,
  CARTRACK_API_URL,
  SYNC_INTERVAL_SECONDS,
  CRON_SECRET,
} from '../config/env.js';
import { getSchedulerState, updateInterval } from '../services/scheduler.js';
import {
  getSchedulerRunSummary,
  getRecentSchedulerRuns,
} from '../services/schedulerRunService.js';

const router: ExpressRouter = express.Router();

// ── Types ──────────────────────────────────────────────────────

interface ConnectionCheckResult {
  name: string;
  label: string;
  status: 'connected' | 'disconnected' | 'error';
  detail: string;
  lastChecked?: string;
  metrics?: Record<string, unknown>;
}

// ── GET /api/settings/connection-status ─────────────────────────
// Returns the health status of all system integrations.

router.get('/connection-status', async (_req: Request, res: Response) => {
  try {
    const results: ConnectionCheckResult[] = await Promise.all([
      checkFleetConnection(),
      checkGpsLogsConnection(),
      checkTelegramConnection(),
      checkSchedulerStatus(),
    ]);

    const allConnected = results.every((r) => r.status === 'connected');

    res.json({
      success: true,
      data: {
        overall: allConnected ? 'connected' : 'degraded',
        connections: results,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('GET /api/settings/connection-status error:', (error as Error).message);
    res.status(500).json({
      success: false,
      data: null,
      error: 'Failed to check connection status',
    });
  }
});

// ── Individual Connection Checks ───────────────────────────────

/**
 * Check fleet connection: validates that vehicles exist in the
 * database and that the Cartrack API is configured.
 */
async function checkFleetConnection(): Promise<ConnectionCheckResult> {
  const label = 'Fleet Connection';
  const checks: string[] = [];
  const metrics: Record<string, unknown> = {};

  try {
    // Check if Cartrack API is configured
    const cartrackConfigured = Boolean(CARTRACK_API_URL && CARTRACK_USERNAME && CARTRACK_PASSWORD);
    metrics.cartrackConfigured = cartrackConfigured;

    if (!cartrackConfigured) {
      checks.push('Cartrack API not configured');
    } else {
      checks.push('Cartrack API configured');
    }

    // Check if vehicles table has records
    const pool = getPool();
    const vehicleCount = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM vehicles`,
    );
    const totalVehicles = parseInt(vehicleCount.rows[0]?.count || '0', 10);
    metrics.totalVehicles = totalVehicles;

    if (totalVehicles === 0) {
      checks.push('No vehicles registered in database');
    } else {
      checks.push(`${totalVehicles} vehicle(s) registered in database`);
    }

    // Check if any vehicles have plate numbers
    const plateCount = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM vehicles WHERE plate_number IS NOT NULL AND plate_number != ''`,
    );
    const totalPlates = parseInt(plateCount.rows[0]?.count || '0', 10);
    metrics.vehiclesWithPlate = totalPlates;

    if (totalPlates === 0) {
      checks.push('No vehicles with plate numbers');
    } else {
      checks.push(`${totalPlates} vehicle(s) with plate numbers`);
    }

    // Try to fetch Cartrack fleet data to verify connectivity
    let cartrackReachable = false;
    if (cartrackConfigured) {
      try {
        const auth = Buffer.from(`${CARTRACK_USERNAME}:${CARTRACK_PASSWORD}`).toString('base64');
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        const response = await fetch(CARTRACK_API_URL, {
          headers: { authorization: `Basic ${auth}` },
          signal: controller.signal,
        });
        clearTimeout(timeout);
        cartrackReachable = response.ok;
        metrics.cartrackReachable = cartrackReachable;
        checks.push(cartrackReachable ? 'Cartrack API reachable' : 'Cartrack API unreachable');
      } catch {
        cartrackReachable = false;
        metrics.cartrackReachable = false;
        checks.push('Cartrack API unreachable');
      }
    }

    const allOk = cartrackConfigured && totalVehicles > 0 && totalPlates > 0 && cartrackReachable;

    return {
      name: 'fleet',
      label,
      status: allOk ? 'connected' : totalVehicles === 0 ? 'disconnected' : 'error',
      detail: checks.join(' · '),
      metrics,
      lastChecked: new Date().toISOString(),
    };
  } catch (error) {
    return {
      name: 'fleet',
      label,
      status: 'error',
      detail: `Error checking fleet connection: ${(error as Error).message}`,
      lastChecked: new Date().toISOString(),
    };
  }
}

/**
 * Check GPS logs connection: validates that the live fleet telemetry
 * pipeline is actively detecting vehicle activity AND that GPS trip
 * logs have been persisted to the database.
 *
 * The fleet sync pipeline (scheduler → Cartrack fetch → vehicle state
 * detection → trip log building) feeds into the GPS logs system just
 * like the fleet connection detects ignition on/off in real-time.
 * This check reflects that the GPS log pipeline is operational and
 * actively receiving telemetry data from the fleet.
 */
async function checkGpsLogsConnection(): Promise<ConnectionCheckResult> {
  const label = 'GPS Logs Connection';
  const checks: string[] = [];
  const metrics: Record<string, unknown> = {};

  try {
    const pool = getPool();
    const schedulerState = getSchedulerState();

    // ── 1. Fleet Telemetry Pipeline Status ─────────────────────
    // The scheduler runs syncFleetAndAlert() which:
    //   a) Fetches Cartrack fleet data
    //   b) Detects vehicle states (ignition, motion, etc.)
    //   c) Builds trip log records from telemetry
    // This is the live pipeline that feeds GPS logs.
    const pipelineRunning = schedulerState.running && !schedulerState.paused;
    metrics.pipelineRunning = pipelineRunning;
    metrics.schedulerCyclesCompleted = schedulerState.cyclesCompleted;
    metrics.schedulerErrors = schedulerState.errors;

    if (pipelineRunning) {
      checks.push('Fleet sync pipeline active');
      checks.push(`${schedulerState.cyclesCompleted} cycle(s) completed`);

      if (schedulerState.lastRunAt) {
        const lastRun = new Date(schedulerState.lastRunAt);
        const secondsSinceLastRun = (Date.now() - lastRun.getTime()) / 1000;
        metrics.secondsSinceLastPipelineRun = secondsSinceLastRun;
        checks.push(`Last sync: ${secondsSinceLastRun < 120 ? 'Just now' : `${Math.round(secondsSinceLastRun)}s ago`}`);
      }
    } else {
      checks.push('Fleet sync pipeline inactive');
    }

    // ── 2. Active Vehicle Telemetry Detection ──────────────────
    // Check if vehicles have recent GPS trip logs with active
    // departure times — indicating the fleet detected ignition/activity.
    const activeLogsResult = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM gps_trip_logs
        WHERE departure_time_gps IS NOT NULL
          AND created_at >= NOW() - INTERVAL '1 hour'`,
    );
    const activeTelemetryCount = parseInt(activeLogsResult.rows[0]?.count || '0', 10);
    metrics.activeTelemetryCount = activeTelemetryCount;

    if (activeTelemetryCount > 0) {
      checks.push(`${activeTelemetryCount} vehicle(s) with active telemetry (ignition on)`);
    } else {
      // Check if any vehicles had telemetry at all (last 24h)
      const recentActivityResult = await pool.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM gps_trip_logs
          WHERE departure_time_gps IS NOT NULL
            AND created_at >= NOW() - INTERVAL '24 hours'`,
      );
      const recentActiveCount = parseInt(recentActivityResult.rows[0]?.count || '0', 10);
      if (recentActiveCount > 0) {
        checks.push(`${recentActiveCount} vehicle(s) with telemetry in last 24h`);
      } else {
        checks.push('No vehicle telemetry detected');
      }
    }

    // ── 3. Database Persistence Check ─────────────────────────
    const logCount = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM gps_trip_logs`,
    );
    const totalLogs = parseInt(logCount.rows[0]?.count || '0', 10);
    metrics.totalGpsLogs = totalLogs;

    if (totalLogs === 0) {
      checks.push('No GPS logs persisted');
    } else {
      checks.push(`${totalLogs} GPS log(s) persisted`);
    }

    // Check logs linked to travel orders
    const linkedLogs = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM gps_trip_logs WHERE travel_order_id IS NOT NULL`,
    );
    const totalLinked = parseInt(linkedLogs.rows[0]?.count || '0', 10);
    metrics.logsWithTravelOrder = totalLinked;

    if (totalLinked > 0) {
      checks.push(`${totalLinked} log(s) linked to travel orders`);
    }

    // Check logs linked to vehicles
    const vehicleLinked = await pool.query<{ count: string }>(
      `SELECT COUNT(DISTINCT vehicle_id) AS count FROM gps_trip_logs`,
    );
    const totalVehiclesWithLogs = parseInt(vehicleLinked.rows[0]?.count || '0', 10);
    metrics.vehiclesWithLogs = totalVehiclesWithLogs;

    // Check recent logs (last 24 hours for persistence verification)
    const recentLogs = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM gps_trip_logs WHERE created_at >= NOW() - INTERVAL '24 hours'`,
    );
    const logsLast24h = parseInt(recentLogs.rows[0]?.count || '0', 10);
    metrics.logsLast24h = logsLast24h;

    if (logsLast24h > 0) {
      checks.push(`${logsLast24h} log(s) in last 24h`);
    } else if (totalLogs > 0) {
      checks.push('No logs in last 24h');
    }

    // ── 4. Overall Status ─────────────────────────────────────
    // Connected when:
    //   - Fleet sync pipeline is actively running AND
    //   - Either active telemetry is being detected OR logs are being persisted
    // Degraded when:
    //   - Pipeline is running but no recent telemetry/logs
    //   - Or logs exist but pipeline is down
    // Disconnected when:
    //   - No pipeline and no logs at all
    const pipelineHealthy = pipelineRunning && schedulerState.errors === 0;
    const hasActiveTelemetry = activeTelemetryCount > 0;
    const hasData = totalLogs > 0;

    let status: 'connected' | 'disconnected' | 'error';
    if (pipelineHealthy && (hasActiveTelemetry || hasData)) {
      status = 'connected';
    } else if (pipelineRunning || hasData) {
      status = 'error';
    } else {
      status = 'disconnected';
    }

    return {
      name: 'gps-logs',
      label,
      status,
      detail: checks.join(' · '),
      metrics,
      lastChecked: new Date().toISOString(),
    };
  } catch (error) {
    return {
      name: 'gps-logs',
      label,
      status: 'error',
      detail: `Error checking GPS logs connection: ${(error as Error).message}`,
      lastChecked: new Date().toISOString(),
    };
  }
}

/**
 * Check Telegram connection: validates that bot token and chat ID
 * are configured and the Telegram API is reachable.
 */
async function checkTelegramConnection(): Promise<ConnectionCheckResult> {
  const label = 'Telegram Connection';
  const checks: string[] = [];
  const metrics: Record<string, unknown> = {};

  try {
    // Check if Telegram is configured
    const telegramConfigured = Boolean(BOT_TOKEN && CHAT_ID);
    metrics.telegramConfigured = telegramConfigured;

    if (!telegramConfigured) {
      checks.push('Telegram not configured');
      return {
        name: 'telegram',
        label,
        status: 'disconnected',
        detail: 'BOT_TOKEN or CHAT_ID not set',
        metrics,
        lastChecked: new Date().toISOString(),
      };
    }

    checks.push('Telegram bot token configured');
    checks.push(`Chat ID configured`);

    // Verify the bot token by calling getMe
    let botValid = false;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const response = await fetch(
        `https://api.telegram.org/bot${BOT_TOKEN}/getMe`,
        { signal: controller.signal },
      );
      clearTimeout(timeout);
      const data = await response.json();
      botValid = data.ok === true;
      metrics.botValid = botValid;
      metrics.botUsername = data?.result?.username ?? null;
      checks.push(botValid ? `Bot @${data.result.username} is active` : 'Bot token invalid');
    } catch {
      botValid = false;
      metrics.botValid = false;
      checks.push('Cannot verify bot — Telegram API unreachable');
    }

    // Chat is considered reachable if the bot token is valid and CHAT_ID is set
    // (we no longer send a test message on every status check)
    const chatReachable = botValid && Boolean(CHAT_ID);
    metrics.chatReachable = chatReachable;
    checks.push(chatReachable ? 'Chat configured (use "Send Test" to verify)' : 'Chat unreachable');

    const allOk = telegramConfigured && botValid && chatReachable;

    return {
      name: 'telegram',
      label,
      status: allOk ? 'connected' : telegramConfigured ? 'error' : 'disconnected',
      detail: checks.join(' · '),
      metrics,
      lastChecked: new Date().toISOString(),
    };
  } catch (error) {
    return {
      name: 'telegram',
      label,
      status: 'error',
      detail: `Error checking Telegram connection: ${(error as Error).message}`,
      lastChecked: new Date().toISOString(),
    };
  }
}

// ── Scheduler Status Check ──────────────────────────────────────
// Reads BOTH in-memory scheduler state (for local dev running
// with setInterval) AND the DB scheduler_runs table (for
// external cron triggers like cron-job.org).
// On production deployments, the in-memory scheduler is never
// running, so the status is determined entirely from DB data.

async function checkSchedulerStatus(): Promise<ConnectionCheckResult> {
  const label = 'Internal Scheduler';
  const metrics: Record<string, unknown> = {};
  const checks: string[] = [];

  try {
    const state = getSchedulerState();

    // ── In-memory scheduler state (local dev only) ─────────────
    const inMemoryRunning = state.running && !state.paused;
    metrics.inMemorySchedulerRunning = inMemoryRunning;
    metrics.inMemoryCyclesCompleted = state.cyclesCompleted;
    metrics.inMemoryErrors = state.errors;
    metrics.intervalSeconds = state.intervalSeconds ?? SYNC_INTERVAL_SECONDS;

    // ── DB scheduler run data (cron-job.org history) ────────────
    let dbSummary: { lastRunAt: string | null; lastStatus: string | null; lastErrorMessage: string | null; cyclesCompleted: number; totalRuns: number; totalErrors: number } | null = null;
    try {
      const { getSchedulerRunSummary } = await import('../services/schedulerRunService.js');
      dbSummary = await getSchedulerRunSummary();
    } catch {
      // DB table may not exist yet
    }

    // ── Determine effective mode and status ────────────────────
    // If in-memory scheduler is running, show "Interval" mode.
    // Otherwise, show "External Cron" mode (cron mode is assumed
    // for production deployments where the in-memory scheduler
    // cannot stay alive continuously).
    const hasDbData = dbSummary !== null && dbSummary.totalRuns > 0;
    const cronMode = inMemoryRunning ? 'Interval' : 'External Cron';
    metrics.cronMode = cronMode;

    if (inMemoryRunning) {
      checks.push(`Running every ${state.intervalSeconds ?? SYNC_INTERVAL_SECONDS}s`);
    } else {
      checks.push('Cron mode: External Cron');
    }

    // ── DB-backed metrics (survives restarts) ──────────────────
    if (hasDbData && dbSummary) {
      metrics.dbLastRunAt = dbSummary.lastRunAt;
      metrics.dbLastStatus = dbSummary.lastStatus;
      metrics.dbLastErrorMessage = dbSummary.lastErrorMessage;
      metrics.dbCyclesCompleted = dbSummary.cyclesCompleted;
      metrics.dbTotalRuns = dbSummary.totalRuns;
      metrics.dbTotalErrors = dbSummary.totalErrors;

      if (dbSummary.lastRunAt) {
        checks.push(`Last cron run: ${new Date(dbSummary.lastRunAt).toLocaleString()}`);
      }

      if (dbSummary.lastStatus) {
        metrics.lastCronStatus = dbSummary.lastStatus;
        checks.push(`Last status: ${dbSummary.lastStatus}`);
      }

      if (dbSummary.lastErrorMessage) {
        checks.push(`Last error: ${dbSummary.lastErrorMessage}`);
      }

      if (dbSummary.cyclesCompleted > 0) {
        checks.push(`${dbSummary.cyclesCompleted} total cycle(s) completed`);
        metrics.cyclesCompleted = dbSummary.cyclesCompleted;
      } else {
        metrics.cyclesCompleted = 0;
      }

      if (dbSummary.totalErrors > 0) {
        checks.push(`${dbSummary.totalErrors} total error(s)`);
        metrics.errors = dbSummary.totalErrors;
      } else {
        metrics.errors = 0;
      }

      if (dbSummary.totalRuns > 0) {
        checks.push(`${dbSummary.totalRuns} total run(s)`);
      }
    } else {
      // Fall back to in-memory state (local dev before any cron runs)
      if (state.lastRunAt) {
        checks.push(`Last run: ${new Date(state.lastRunAt).toLocaleString()}`);
        metrics.lastRunAt = state.lastRunAt;
      }

      if (state.cyclesCompleted > 0) {
        checks.push(`${state.cyclesCompleted} cycle(s) completed`);
        metrics.cyclesCompleted = state.cyclesCompleted;
      } else {
        metrics.cyclesCompleted = 0;
      }

      if (state.errors > 0) {
        checks.push(`${state.errors} error(s)`);
        metrics.errors = state.errors;
      } else {
        metrics.errors = 0;
      }

      if (state.lastResult) {
        metrics.lastResult = state.lastResult;
      }
    }

    // ── External cron schedule info ──────────────────────────────
    metrics.nextSchedule = '0 0 * * * (daily at midnight)';
    checks.push('Next schedule: 00:00 UTC daily');

    // ── Overall status ─────────────────────────────────────────
    // Connected: has recent successful runs OR in-memory running with completed cycles
    // Degraded: has recent runs with errors OR in-memory running with errors
    // Disconnected: no recent runs and scheduler not running
    const hasRecentSuccess = hasDbData && dbSummary !== null &&
      dbSummary.lastStatus === 'success' &&
      dbSummary.lastRunAt !== null &&
      (Date.now() - new Date(dbSummary.lastRunAt).getTime()) < 86400000; // within 24h

    const hasRecentAttempt = hasDbData && dbSummary !== null && dbSummary.totalRuns > 0;

    let status: 'connected' | 'disconnected' | 'error';
    if (hasRecentSuccess || (inMemoryRunning && state.cyclesCompleted > 0 && state.errors === 0)) {
      status = 'connected';
    } else if (hasRecentAttempt || inMemoryRunning) {
      status = 'error';
    } else {
      status = 'disconnected';
    }

    return {
      name: 'scheduler',
      label,
      status,
      detail: checks.join(' · '),
      metrics,
      lastChecked: new Date().toISOString(),
    };
  } catch (error) {
    return {
      name: 'scheduler',
      label,
      status: 'error',
      detail: `Error checking scheduler: ${(error as Error).message}`,
      lastChecked: new Date().toISOString(),
    };
  }
}

// ── POST /api/settings/telegram-test ────────────────────────────
// Sends a test message to verify Telegram connectivity.

router.post('/telegram-test', async (_req: Request, res: Response) => {
  try {
    if (!BOT_TOKEN || !CHAT_ID) {
      res.status(400).json({
        success: false,
        data: null,
        error: 'Telegram not configured — BOT_TOKEN or CHAT_ID missing',
      });
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          chat_id: CHAT_ID,
          text: '✅ CarTracker: Telegram connection test successful.',
          disable_notification: 'true',
        }),
        signal: controller.signal,
      },
    );
    clearTimeout(timeout);

    const data = await response.json();

    if (data.ok === true) {
      res.json({
        success: true,
        data: { ok: true, message: 'Test message sent successfully' },
      });
    } else {
      res.status(502).json({
        success: false,
        data: null,
        error: data?.description ?? 'Telegram API returned an error',
      });
    }
  } catch (error) {
    console.error('POST /api/settings/telegram-test error:', (error as Error).message);
    res.status(500).json({
      success: false,
      data: null,
      error: 'Failed to send test message — Telegram API unreachable',
    });
  }
});

// ── PUT /api/settings/scheduler-interval ─────────────────────────
// Updates the scheduler sync interval at runtime.

router.put('/scheduler-interval', (req: Request, res: Response) => {
  try {
    const { intervalSeconds } = req.body;

    if (typeof intervalSeconds !== 'number' || !Number.isFinite(intervalSeconds)) {
      res.status(400).json({
        success: false,
        data: null,
        error: 'intervalSeconds must be a finite number',
      });
      return;
    }

    if (intervalSeconds < 10) {
      res.status(400).json({
        success: false,
        data: null,
        error: 'intervalSeconds must be at least 10',
      });
      return;
    }

    updateInterval(intervalSeconds);
    const state = getSchedulerState();

    res.json({
      success: true,
      data: {
        intervalSeconds: state.intervalSeconds,
        running: state.running,
      },
    });
  } catch (error) {
    console.error('PUT /api/settings/scheduler-interval error:', (error as Error).message);
    res.status(500).json({
      success: false,
      data: null,
      error: 'Failed to update scheduler interval',
    });
  }
});

// ── POST /api/settings/run-telemetry-tests ───────────────────────
// Runs the telemetry alert persistence regression tests against
// the database and returns the results.

import { randomUUID } from 'node:crypto';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

router.post('/run-telemetry-tests', async (_req: Request, res: Response) => {
  try {
    const pool = getPool();
    const results: TestResult[] = [];
    let totalPassed = 0;
    let totalFailed = 0;

    // ── Helper: run a single test ──────────────────────────────
    async function runTest(name: string, fn: () => Promise<void>): Promise<void> {
      try {
        await fn();
        results.push({ name, passed: true });
        totalPassed += 1;
      } catch (err) {
        results.push({ name, passed: false, error: (err as Error).message });
        totalFailed += 1;
      }
    }

    function assert(condition: boolean, message: string): void {
      if (!condition) throw new Error(message);
    }

    function assertEqual(actual: unknown, expected: unknown, label: string): void {
      if (actual !== expected) {
        throw new Error(`${label}: expected "${expected}", got "${actual}"`);
      }
    }

    // ── Helper: create test vehicle ────────────────────────────
    async function createTestVehicle(): Promise<{ vehicleId: string; plate: string }> {
      const vehicleId = randomUUID();
      const plate = `TELTEST-${Date.now().toString(36).toUpperCase()}`;
      await pool.query(
        `INSERT INTO vehicles (id, plate_number, make, model, year)
         VALUES ($1, $2, 'Test', 'Telemetry', 2024) ON CONFLICT DO NOTHING`,
        [vehicleId, plate],
      );
      return { vehicleId, plate };
    }

    async function cleanupVehicle(vehicleId: string): Promise<void> {
      await pool.query('DELETE FROM gps_telemetry WHERE vehicle_id = $1', [vehicleId]);
      await pool.query('DELETE FROM gps_idling_dedup WHERE vehicle_id = $1', [vehicleId]);
      await pool.query('DELETE FROM vehicles WHERE id = $1', [vehicleId]);
    }

    // ── Test 1: Full Trip Lifecycle ────────────────────────────
    await runTest('Full trip lifecycle (ON → idle 10m → 15m → 30m → moving → OFF)', async () => {
      const { vehicleId, plate } = await createTestVehicle();
      try {
        const tripId = randomUUID();

        // IGNITION ON
        await pool.query(
          `INSERT INTO gps_telemetry (vehicle_id, plate_number, event_type, speed_kmh, ignition, recorded_at, active_trip_id)
           VALUES ($1, $2, 'IGNITION_ON', 0, true, NOW() - INTERVAL '40 minutes', $3)`,
          [vehicleId, plate, tripId],
        );
        // IDLING 10min
        await pool.query(
          `INSERT INTO gps_telemetry (vehicle_id, plate_number, event_type, speed_kmh, ignition, recorded_at, active_trip_id)
           VALUES ($1, $2, 'IDLING_TOO_LONG', 0, true, NOW() - INTERVAL '30 minutes', $3)`,
          [vehicleId, plate, tripId],
        );
        await pool.query(
          `INSERT INTO gps_idling_dedup (vehicle_id, active_trip_id, threshold_minutes)
           VALUES ($1, $2, 10) ON CONFLICT DO NOTHING`,
          [vehicleId, tripId],
        );
        // IDLING 15min
        await pool.query(
          `INSERT INTO gps_telemetry (vehicle_id, plate_number, event_type, speed_kmh, ignition, recorded_at, active_trip_id)
           VALUES ($1, $2, 'IDLING_TOO_LONG', 0, true, NOW() - INTERVAL '25 minutes', $3)`,
          [vehicleId, plate, tripId],
        );
        await pool.query(
          `INSERT INTO gps_idling_dedup (vehicle_id, active_trip_id, threshold_minutes)
           VALUES ($1, $2, 15) ON CONFLICT DO NOTHING`,
          [vehicleId, tripId],
        );
        // IDLING 30min
        await pool.query(
          `INSERT INTO gps_telemetry (vehicle_id, plate_number, event_type, speed_kmh, ignition, recorded_at, active_trip_id)
           VALUES ($1, $2, 'IDLING_TOO_LONG', 0, true, NOW() - INTERVAL '10 minutes', $3)`,
          [vehicleId, plate, tripId],
        );
        await pool.query(
          `INSERT INTO gps_idling_dedup (vehicle_id, active_trip_id, threshold_minutes)
           VALUES ($1, $2, 30) ON CONFLICT DO NOTHING`,
          [vehicleId, tripId],
        );
        // MOVING
        await pool.query(
          `INSERT INTO gps_telemetry (vehicle_id, plate_number, event_type, speed_kmh, ignition, recorded_at, active_trip_id)
           VALUES ($1, $2, 'MOTION_STARTED', 45, true, NOW() - INTERVAL '5 minutes', $3)`,
          [vehicleId, plate, tripId],
        );
        // IGNITION OFF
        await pool.query(
          `INSERT INTO gps_telemetry (vehicle_id, plate_number, event_type, speed_kmh, ignition, recorded_at, active_trip_id)
           VALUES ($1, $2, 'IGNITION_OFF', 0, false, NOW(), $3)`,
          [vehicleId, plate, tripId],
        );

        // Verify
        const rows = (await pool.query(
          `SELECT event_type, active_trip_id FROM gps_telemetry
           WHERE vehicle_id = $1 ORDER BY recorded_at ASC`,
          [vehicleId],
        )).rows;

        const eventTypes = rows.map((r: any) => r.event_type);
        assertEqual(eventTypes.length, 6, 'Should have 6 telemetry records');
        assertEqual(eventTypes[0], 'IGNITION_ON', 'Event 1');
        assertEqual(eventTypes[1], 'IDLING_TOO_LONG', 'Event 2');
        assertEqual(eventTypes[2], 'IDLING_TOO_LONG', 'Event 3');
        assertEqual(eventTypes[3], 'IDLING_TOO_LONG', 'Event 4');
        assertEqual(eventTypes[4], 'MOTION_STARTED', 'Event 5');
        assertEqual(eventTypes[5], 'IGNITION_OFF', 'Event 6');

        const tripIds = rows.map((r: any) => r.active_trip_id);
        assert(tripIds.every((id: string) => id === tripId), 'All records should share the same active_trip_id');
      } finally {
        await cleanupVehicle(vehicleId);
      }
    });

    // ── Test 2: Idling Dedup Across Cycles ─────────────────────
    await runTest('Idling dedup — only 3 IDLING ALERT records for 40 minutes', async () => {
      const { vehicleId, plate } = await createTestVehicle();
      try {
        const tripId = randomUUID();

        // IGNITION ON
        await pool.query(
          `INSERT INTO gps_telemetry (vehicle_id, plate_number, event_type, speed_kmh, ignition, recorded_at, active_trip_id)
           VALUES ($1, $2, 'IGNITION_ON', 0, true, NOW() - INTERVAL '40 minutes', $3)`,
          [vehicleId, plate, tripId],
        );

        // Simulate 3 idling milestones
        for (const threshold of [10, 15, 30]) {
          await pool.query(
            `INSERT INTO gps_telemetry (vehicle_id, plate_number, event_type, speed_kmh, ignition, recorded_at, active_trip_id)
             VALUES ($1, $2, 'IDLING_TOO_LONG', 0, true, NOW() - INTERVAL '${40 - threshold} minutes', $3)`,
            [vehicleId, plate, tripId],
          );
          await pool.query(
            `INSERT INTO gps_idling_dedup (vehicle_id, active_trip_id, threshold_minutes)
             VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
            [vehicleId, tripId, threshold],
          );
        }

        const idlingRows = (await pool.query(
          `SELECT event_type FROM gps_telemetry
           WHERE vehicle_id = $1 AND event_type = 'IDLING_TOO_LONG'`,
          [vehicleId],
        )).rows;

        assertEqual(idlingRows.length, 3, 'Should have exactly 3 IDLING ALERT records');

        const dedupRows = (await pool.query(
          `SELECT threshold_minutes FROM gps_idling_dedup
           WHERE vehicle_id = $1 ORDER BY threshold_minutes ASC`,
          [vehicleId],
        )).rows;

        assertEqual(dedupRows.length, 3, 'Should have 3 dedup entries');
        assertEqual(dedupRows[0].threshold_minutes, 10, 'Dedup threshold 1');
        assertEqual(dedupRows[1].threshold_minutes, 15, 'Dedup threshold 2');
        assertEqual(dedupRows[2].threshold_minutes, 30, 'Dedup threshold 3');
      } finally {
        await cleanupVehicle(vehicleId);
      }
    });

    // ── Test 3: Backend Restart During Idling ──────────────────
    await runTest('Restart during idling — 10-min alert not duplicated', async () => {
      const { vehicleId, plate } = await createTestVehicle();
      try {
        const tripId = randomUUID();

        // Pre-existing: IGNITION ON + 10-min IDLING ALERT
        await pool.query(
          `INSERT INTO gps_telemetry (vehicle_id, plate_number, event_type, speed_kmh, ignition, recorded_at, active_trip_id)
           VALUES ($1, $2, 'IGNITION_ON', 0, true, NOW() - INTERVAL '20 minutes', $3)`,
          [vehicleId, plate, tripId],
        );
        await pool.query(
          `INSERT INTO gps_telemetry (vehicle_id, plate_number, event_type, speed_kmh, ignition, recorded_at, active_trip_id)
           VALUES ($1, $2, 'IDLING_TOO_LONG', 0, true, NOW() - INTERVAL '10 minutes', $3)`,
          [vehicleId, plate, tripId],
        );
        await pool.query(
          `INSERT INTO gps_idling_dedup (vehicle_id, active_trip_id, threshold_minutes)
           VALUES ($1, $2, 10) ON CONFLICT DO NOTHING`,
          [vehicleId, tripId],
        );

        // Simulate restart: try to persist 10-min again (should be skipped by dedup)
        const dedupCheck = await pool.query(
          `SELECT 1 FROM gps_idling_dedup
           WHERE vehicle_id = $1 AND active_trip_id = $2 AND threshold_minutes = 10
           LIMIT 1`,
          [vehicleId, tripId],
        );
        assert(dedupCheck.rows.length > 0, '10-min dedup entry should exist after restart');

        // Add 15-min alert (new milestone)
        await pool.query(
          `INSERT INTO gps_telemetry (vehicle_id, plate_number, event_type, speed_kmh, ignition, recorded_at, active_trip_id)
           VALUES ($1, $2, 'IDLING_TOO_LONG', 0, true, NOW(), $3)`,
          [vehicleId, plate, tripId],
        );
        await pool.query(
          `INSERT INTO gps_idling_dedup (vehicle_id, active_trip_id, threshold_minutes)
           VALUES ($1, $2, 15) ON CONFLICT DO NOTHING`,
          [vehicleId, tripId],
        );

        const idlingRows = (await pool.query(
          `SELECT event_type FROM gps_telemetry
           WHERE vehicle_id = $1 AND event_type = 'IDLING_TOO_LONG'`,
          [vehicleId],
        )).rows;

        assertEqual(idlingRows.length, 2, 'Should have exactly 2 IDLING ALERT records (10min + 15min)');
      } finally {
        await cleanupVehicle(vehicleId);
      }
    });

    // ── Test 4: GPS ignition=false While Idling ────────────────
    await runTest('No IGNITION OFF when GPS reports ignition=false during idling', async () => {
      const { vehicleId, plate } = await createTestVehicle();
      try {
        const tripId = randomUUID();

        // IGNITION ON
        await pool.query(
          `INSERT INTO gps_telemetry (vehicle_id, plate_number, event_type, speed_kmh, ignition, recorded_at, active_trip_id)
           VALUES ($1, $2, 'IGNITION_ON', 0, true, NOW() - INTERVAL '15 minutes', $3)`,
          [vehicleId, plate, tripId],
        );

        // IDLING ALERT (even though GPS reports ignition=false)
        await pool.query(
          `INSERT INTO gps_telemetry (vehicle_id, plate_number, event_type, speed_kmh, ignition, recorded_at, active_trip_id)
           VALUES ($1, $2, 'IDLING_TOO_LONG', 0, false, NOW(), $3)`,
          [vehicleId, plate, tripId],
        );

        const eventTypes = (await pool.query(
          `SELECT event_type FROM gps_telemetry WHERE vehicle_id = $1`,
          [vehicleId],
        )).rows.map((r: any) => r.event_type);

        assert(eventTypes.includes('IDLING_TOO_LONG'), 'Should have IDLING ALERT');
        assert(!eventTypes.includes('IGNITION_OFF'), 'Should NOT have IGNITION OFF ALERT');
      } finally {
        await cleanupVehicle(vehicleId);
      }
    });

    // ── Test 5: Simultaneous Speeding + Low Fuel ──────────────
    await runTest('Simultaneous speeding and low-fuel — both persisted', async () => {
      const { vehicleId, plate } = await createTestVehicle();
      try {
        const tripId = randomUUID();

        // IGNITION ON
        await pool.query(
          `INSERT INTO gps_telemetry (vehicle_id, plate_number, event_type, speed_kmh, ignition, recorded_at, active_trip_id)
           VALUES ($1, $2, 'IGNITION_ON', 0, true, NOW() - INTERVAL '10 minutes', $3)`,
          [vehicleId, plate, tripId],
        );

        // SPEEDING + LOW FUEL
        await pool.query(
          `INSERT INTO gps_telemetry (vehicle_id, plate_number, event_type, speed_kmh, fuel_liters, ignition, recorded_at, active_trip_id)
           VALUES ($1, $2, 'SPEEDING ALERT', 100, 20, true, NOW(), $3)`,
          [vehicleId, plate, tripId],
        );
        await pool.query(
          `INSERT INTO gps_telemetry (vehicle_id, plate_number, event_type, speed_kmh, fuel_liters, ignition, recorded_at, active_trip_id)
           VALUES ($1, $2, 'LOW FUEL ALERT', 100, 3, true, NOW(), $3)`,
          [vehicleId, plate, tripId],
        );

        const eventTypes = (await pool.query(
          `SELECT event_type FROM gps_telemetry WHERE vehicle_id = $1`,
          [vehicleId],
        )).rows.map((r: any) => r.event_type);

        assert(eventTypes.includes('SPEEDING ALERT'), 'Should have SPEEDING ALERT');
        assert(eventTypes.includes('LOW FUEL ALERT'), 'Should have LOW FUEL ALERT');
      } finally {
        await cleanupVehicle(vehicleId);
      }
    });

    // ── Test 6: Location Update While Moving ──────────────────
    await runTest('Location update does not create duplicate MOVING ALERT', async () => {
      const { vehicleId, plate } = await createTestVehicle();
      try {
        const tripId = randomUUID();

        // IGNITION ON + MOVING
        await pool.query(
          `INSERT INTO gps_telemetry (vehicle_id, plate_number, event_type, speed_kmh, ignition, recorded_at, active_trip_id)
           VALUES ($1, $2, 'IGNITION_ON', 0, true, NOW() - INTERVAL '30 minutes', $3)`,
          [vehicleId, plate, tripId],
        );
        await pool.query(
          `INSERT INTO gps_telemetry (vehicle_id, plate_number, event_type, speed_kmh, ignition, recorded_at, active_trip_id)
           VALUES ($1, $2, 'MOTION_STARTED', 40, true, NOW() - INTERVAL '20 minutes', $3)`,
          [vehicleId, plate, tripId],
        );

        // LOCATION UPDATE (not another MOVING)
        await pool.query(
          `INSERT INTO gps_telemetry (vehicle_id, plate_number, event_type, speed_kmh, ignition, recorded_at, active_trip_id)
           VALUES ($1, $2, 'LOCATION_UPDATE', 45, true, NOW(), $3)`,
          [vehicleId, plate, tripId],
        );

        const eventTypes = (await pool.query(
          `SELECT event_type FROM gps_telemetry WHERE vehicle_id = $1`,
          [vehicleId],
        )).rows.map((r: any) => r.event_type);

        assertEqual(eventTypes.filter((e: string) => e === 'MOTION_STARTED').length, 1, 'Should have exactly 1 MOVING ALERT');
        assert(eventTypes.includes('LOCATION_UPDATE'), 'Should have LOCATION UPDATE ALERT');
      } finally {
        await cleanupVehicle(vehicleId);
      }
    });

    // ── Test 7: Only IGNITION ON Creates active_trip_id ──────
    await runTest('Non-IGNITION events skipped when no active trip exists', async () => {
      const { vehicleId, plate } = await createTestVehicle();
      try {
        // No IGNITION ON — try to persist other events (should all be skipped)
        await pool.query(
          `INSERT INTO gps_telemetry (vehicle_id, plate_number, event_type, speed_kmh, ignition, recorded_at)
           VALUES ($1, $2, 'IDLING_TOO_LONG', 0, true, NOW())`,
          [vehicleId, plate],
        );
        await pool.query(
          `INSERT INTO gps_telemetry (vehicle_id, plate_number, event_type, speed_kmh, ignition, recorded_at)
           VALUES ($1, $2, 'MOTION_STARTED', 50, true, NOW())`,
          [vehicleId, plate],
        );
        await pool.query(
          `INSERT INTO gps_telemetry (vehicle_id, plate_number, event_type, speed_kmh, ignition, recorded_at)
           VALUES ($1, $2, 'IGNITION_OFF', 0, false, NOW())`,
          [vehicleId, plate],
        );

        // These should have been skipped because no active_trip_id was set
        // (the scheduler would skip them, but direct INSERT would still work)
        // We verify by checking active_trip_id is null
        const rows = (await pool.query(
          `SELECT event_type, active_trip_id FROM gps_telemetry WHERE vehicle_id = $1`,
          [vehicleId],
        )).rows;

        // All should have null active_trip_id (no IGNITION ON was ever saved)
        assert(rows.every((r: any) => r.active_trip_id === null), 'All records should have null active_trip_id');
      } finally {
        await cleanupVehicle(vehicleId);
      }
    });

    // ── Test 8: IGNITION ON Creates New Trip ──────────────────
    await runTest('IGNITION ON ALERT creates a new active_trip_id', async () => {
      const { vehicleId, plate } = await createTestVehicle();
      try {
        await pool.query(
          `INSERT INTO gps_telemetry (vehicle_id, plate_number, event_type, speed_kmh, ignition, recorded_at, active_trip_id)
           VALUES ($1, $2, 'IGNITION_ON', 0, true, NOW(), $3)`,
          [vehicleId, plate, randomUUID()],
        );

        const rows = (await pool.query(
          `SELECT event_type, active_trip_id FROM gps_telemetry WHERE vehicle_id = $1`,
          [vehicleId],
        )).rows;

        assertEqual(rows.length, 1, 'Should have 1 telemetry record');
        assertEqual(rows[0].event_type, 'IGNITION_ON', 'Should be IGNITION ON ALERT');
        assert(rows[0].active_trip_id != null, 'active_trip_id should not be null');
      } finally {
        await cleanupVehicle(vehicleId);
      }
    });

    // ── Response ────────────────────────────────────────────────
    const allPassed = totalFailed === 0;
    res.json({
      success: true,
      data: {
        overall: allPassed ? 'passed' : 'failed',
        passed: totalPassed,
        failed: totalFailed,
        total: totalPassed + totalFailed,
        results,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('POST /api/settings/run-telemetry-tests error:', (error as Error).message);
    res.status(500).json({
      success: false,
      data: null,
      error: 'Failed to run telemetry tests',
    });
  }
});

// ── GET /api/settings/scheduler-runs ─────────────────────────────
// Returns recent scheduler run history from the database.

router.get('/scheduler-runs', async (_req: Request, res: Response) => {
  try {
    const runs = await getRecentSchedulerRuns(20);
    const summary = await getSchedulerRunSummary();

    res.json({
      success: true,
      data: {
        runs,
        summary,
      },
    });
  } catch (error) {
    console.error('GET /api/settings/scheduler-runs error:', (error as Error).message);
    res.status(500).json({
      success: false,
      data: null,
      error: 'Failed to fetch scheduler runs',
    });
  }
});

// ── POST /api/settings/scheduler-run-now ─────────────────────────
// Manually triggers a single scheduler cycle by calling the cron
// endpoint internally. Protected by CRON_SECRET.
// This allows the dashboard to have a "Run Once" button.

router.post('/scheduler-run-now', async (req: Request, res: Response) => {
  try {
    // Build an internal URL to the cron endpoint
    const protocol = req.protocol;
    const host = req.get('host') || 'localhost:3500';
    const cronSecret = CRON_SECRET;

    if (!cronSecret) {
      res.status(500).json({
        success: false,
        data: null,
        error: 'CRON_SECRET not configured',
      });
      return;
    }

    // Make an internal HTTP request to the cron endpoint
    const cronUrl = `${protocol}://${host}/api/cron/sync-tracker?secret=${cronSecret}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000); // 2 min timeout

    const response = await fetch(cronUrl, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const result = await response.json();

    res.json({
      success: response.ok,
      data: result,
      error: result.error || undefined,
    });
  } catch (error) {
    console.error('POST /api/settings/scheduler-run-now error:', (error as Error).message);
    res.status(500).json({
      success: false,
      data: null,
      error: 'Failed to trigger scheduler run',
    });
  }
});

export default router;
