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
} from '../config/env.js';
import { getSchedulerState, updateInterval } from '../services/scheduler.js';

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

function checkSchedulerStatus(): ConnectionCheckResult {
  const label = 'Internal Scheduler';
  const metrics: Record<string, unknown> = {};
  const checks: string[] = [];

  try {
    const state = getSchedulerState();

    metrics.schedulerRunning = state.running;
    metrics.schedulerPaused = state.paused;
    metrics.cyclesCompleted = state.cyclesCompleted;
    metrics.errors = state.errors;
    metrics.intervalSeconds = state.intervalSeconds ?? SYNC_INTERVAL_SECONDS;

    if (state.running) {
      checks.push(`Running every ${state.intervalSeconds ?? SYNC_INTERVAL_SECONDS}s`);
    } else {
      checks.push('Not running');
    }

    if (state.startedAt) {
      checks.push(`Started ${new Date(state.startedAt).toLocaleString()}`);
      metrics.startedAt = state.startedAt;
    }

    if (state.lastRunAt) {
      checks.push(`Last run: ${new Date(state.lastRunAt).toLocaleString()}`);
      metrics.lastRunAt = state.lastRunAt;
    }

    if (state.lastRunDuration !== null) {
      checks.push(`Last run took ${state.lastRunDuration.toFixed(1)}s`);
    }

    if (state.cyclesCompleted > 0) {
      checks.push(`${state.cyclesCompleted} cycle(s) completed`);
    }

    if (state.errors > 0) {
      checks.push(`${state.errors} error(s)`);
    }

    if (state.lastResult) {
      metrics.lastResult = state.lastResult;
    }

    const allOk = state.running && state.cyclesCompleted > 0 && state.errors === 0;
    const partialOk = state.running;

    return {
      name: 'scheduler',
      label,
      status: allOk ? 'connected' : partialOk ? 'error' : 'disconnected',
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

export default router;
