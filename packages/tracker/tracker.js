// ── Fleet Telemetry & Alert Engine ────────────────────────────
//
// Core tracking module: fetches fleet data from the Cartrack API,
// extracts vehicle status, computes speeding/idling/fuel thresholds,
// generates Telegram notifications, and persists alerts to Supabase.
//
// Environment Variables (loaded automatically via process.env):
//   CARTRACK_API_URL, CARTRACK_USERNAME, CARTRACK_PASSWORD
//   SPEED_LIMIT_KMH (default 90)
//   LOW_FUEL_LITERS (default 5)
//   ALERT_DEDUPE_SECONDS (default 300)
//   CARTRACK_TIMEOUT_MS (default 15000)
//   CARTRACK_RETRIES (default 1)
//   FLEET_CACHE_SECONDS (default 30)
//   FLEET_STALE_CACHE_SECONDS (default 3600)
//   BOT_TOKEN, CHAT_ID (Telegram)

import { alreadySentRecently, getJson, setJson } from './state.js';
import { insertAlertsToSupabase, isSupabaseConfigured, findVehicleIdByPlate } from './supabase.js';
import { buildTripLogRecord } from './tripLogTransformer.js';
import pg from 'pg';
import {
  processTripState,
  consumeOrigin,
  consumeDestination,
  hasVehicleArrived,
  getReturnTripState,
  resetVehicleState,
} from './tripStateTracker.js';

// ── Configuration from Environment ────────────────────────────

export const SPEED_LIMIT_KMH = Number(process.env.SPEED_LIMIT_KMH || 90);
export const LOW_FUEL_LITERS = Number(process.env.LOW_FUEL_LITERS || 5);
// Idling alert thresholds in minutes (cumulative total idle time).
// First alert at 10 minutes, next at 25, then every additional 30 minutes.
// This produces: 10, 25, 55, 85, 115, ...
export const IDLE_ALERT_THRESHOLDS_MINUTES = (() => {
  const thresholds = [10, 25];
  for (let next = 55; thresholds.length < 20; next += 30) thresholds.push(next);
  return thresholds;
})();
export const IDLE_LIMIT_MINUTES = IDLE_ALERT_THRESHOLDS_MINUTES[0];
export const ALERT_DEDUPE_SECONDS = Number(process.env.ALERT_DEDUPE_SECONDS || process.env.SYNC_INTERVAL_SECONDS || 300);
export const CARTRACK_TIMEOUT_MS = Number(process.env.CARTRACK_TIMEOUT_MS || 15000);
export const CARTRACK_RETRIES = Number(process.env.CARTRACK_RETRIES || 1);
export const FLEET_CACHE_SECONDS = Number(process.env.FLEET_CACHE_SECONDS || 30);
export const FLEET_STALE_CACHE_SECONDS = Number(process.env.FLEET_STALE_CACHE_SECONDS || 3600);

// ── Vehicle Key Heuristics ────────────────────────────────────
//
// Vehicle identification is resolved STRICTLY via database plate
// number lookups. The keys below are used only to extract the raw
// plate number string from the incoming Cartrack payload.

const VEHICLE_ID_KEYS = ['vehicle_id', 'vehicleId', 'id', 'unit_id', 'unitId', 'asset_id', 'assetId', 'device_id', 'deviceId', 'registration'];
const PLATE_NUMBER_KEYS = ['registration', 'plate_number', 'plate', 'reg', 'license_plate', 'vehicle_name', 'vehicleName', 'name', 'label'];
const VEHICLE_LIST_KEYS = ['data', 'vehicles', 'vehicle', 'items', 'results', 'fleet', 'assets', 'units'];

// ── Canonical Alert Type → Event Type Mapping ─────────────────
//
// Maps internal alert types (used for Telegram dedup and routing)
// to the canonical event_type string saved in gps_telemetry.
// This ensures the database always records the same event type
// that was sent to Telegram, never a re-classified guess.

export const ALERT_TYPE_TO_EVENT_TYPE = {
  trip_state_IGNITION_ON: 'IGNITION_ON',
  trip_state_IGNITION_OFF: 'IGNITION_OFF',
  ignition_ON: 'IGNITION_ON',
  ignition_OFF: 'IGNITION_OFF',
  speeding: 'SPEEDING',
  low_fuel: 'LOW_FUEL',
  idling_too_long: 'IDLING',
  motion: 'MOTION_STARTED',
  location_update: 'LOCATION_UPDATE',
};

// ── Helpers ───────────────────────────────────────────────────

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isRetriableFetchError(error) {
  const code = error?.cause?.code || error?.code;
  return [
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_HEADERS_TIMEOUT',
    'UND_ERR_BODY_TIMEOUT',
    'ECONNRESET',
    'ETIMEDOUT',
    'EAI_AGAIN',
  ].includes(code);
}

async function fetchWithTimeout(url, options = {}, timeoutMs = CARTRACK_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export function firstPresent(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

export function firstKey(data, keys) {
  if (!data || typeof data !== 'object') return null;
  for (const key of keys) {
    if (data[key] !== undefined && data[key] !== null) return data[key];
  }
  return null;
}

export function firstNestedKey(data, keys) {
  if (Array.isArray(data)) {
    for (const item of data) {
      const value = firstNestedKey(item, keys);
      if (value !== null && value !== undefined) return value;
    }
    return null;
  }
  if (!data || typeof data !== 'object') return null;

  const direct = firstKey(data, keys);
  if (direct !== null && direct !== undefined) return direct;

  for (const value of Object.values(data)) {
    const nested = firstNestedKey(value, keys);
    if (nested !== null && nested !== undefined) return nested;
  }
  return null;
}

export function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export function toBool(value, fallback = false) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', 'on', '1', 'yes', 'y', 'running'].includes(normalized)) return true;
    if (['false', 'off', '0', 'no', 'n', 'stopped'].includes(normalized)) return false;
  }
  return Boolean(value);
}

// ── Vehicle Emoji Mapping ────────────────────────────────────

export function getVehicleEmoji(plateNumber) {
  // Extract just the plate number from the name (may include " (TO-123)" or " ()" suffix)
  const plate = String(plateNumber || '').trim().toUpperCase();
  const cleanPlate = plate.split(/[\(\)\s]/)[0]; // Get text before first space or parenthesis
  
  switch (cleanPlate) {
    case 'KAR6558':
      return '🚙';
    case 'KAR6444':
      return '🛻';
    case 'KAR6412':
      return '🚐';
    default:
      return '🚗';
  }
}

// ── Formatting ────────────────────────────────────────────────

export function formatSpeed(speed) {
  const num = Number(speed);
  return Number.isInteger(num) ? String(num) : String(num);
}

export function formatFuelLiters(value) {
  if (value === null || value === undefined) return 'Unknown';
  return `${formatSpeed(value)} L`;
}

export function formatMinutes(minutes) {
  const value = Math.max(0, toNumber(minutes, 0));
  const text = Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10);
  return `${text} minute${text === '1' ? '' : 's'}`;
}

export function getManilaFormatter() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

function getDatePart(parts, type) {
  return parts.find((part) => part.type === type)?.value || '';
}

export function formatEventTime(eventTime) {
  const text = String(eventTime || '').trim();
  if (!text) return 'Unknown time';

  let normalized = text.includes('T') ? text : text.replace(' ', 'T');
  if (/[+-]\d\d$/.test(normalized)) {
    normalized = `${normalized}:00`;
  } else if (!normalized.endsWith('Z') && !/[+-]\d\d:?\d\d$/.test(normalized)) {
    normalized = `${normalized}+08:00`;
  }

  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return text;

  const parts = getManilaFormatter().formatToParts(date);
  const year = getDatePart(parts, 'year');
  const month = getDatePart(parts, 'month');
  const day = getDatePart(parts, 'day');
  const hour = String(Number(getDatePart(parts, 'hour')) || 12);
  const minute = getDatePart(parts, 'minute');
  const second = getDatePart(parts, 'second');
  const dayPeriod = getDatePart(parts, 'dayPeriod').replace(/\./g, '').toUpperCase();

  return `${year}-${month}-${day} ${hour}:${minute}:${second} ${dayPeriod} PHT`;
}

function formatAlert(header, ...lines) {
  return [header, '', ...lines].join('\n');
}

function formatLocationTime(location, eventTime) {
  return [`📍 ${location}`, `🕘 ${formatEventTime(eventTime)}`];
}

export function formatVehicleHeader(name, toNumber = null) {
  const plate = String(name || '').trim();
  if (plate.includes('(') && plate.includes(')')) {
    return plate;
  }
  if (toNumber && String(toNumber).trim()) {
    return `${plate} (${String(toNumber).trim()})`;
  }
  return `${plate} (⚠️ No TO)`;
}

export function formatSpeedingAlert(name, speed, location, eventTime, toNumber = null, driver = null) {
  const excess = Math.max(0, speed - SPEED_LIMIT_KMH);
  const extraLines = [];
  const driverText = typeof driver === 'string' && driver.trim() && !driver.trim().startsWith('{') ? driver.trim() : null;
  extraLines.push(`👤 Driver: ${driverText || 'Unassigned'}`);
  const vehicleEmoji = getVehicleEmoji(name);
  return formatAlert(
    `🚨 SPEEDING - ${vehicleEmoji} ${formatVehicleHeader(name, toNumber)}`,
    `⚡ Speed: ${formatSpeed(speed)} km/h`,
    `Limit: ${SPEED_LIMIT_KMH} km/h`,
    `📈 Excess: +${formatSpeed(excess)} km/h over limit`,
    ...extraLines,
    ...formatLocationTime(location, eventTime),
  );
}

export function formatIgnitionAlert(name, ignition, location, eventTime, toNumber = null, driver = null) {
  const extraLines = [];
  const driverText = typeof driver === 'string' && driver.trim() && !driver.trim().startsWith('{') ? driver.trim() : null;
  extraLines.push(`👤 Driver: ${driverText || 'Unassigned'}`);
  const vehicleEmoji = getVehicleEmoji(name);
  return formatAlert(
    `${ignition ? '🔑 IGNITION ON' : '🔒 IGNITION OFF'} - ${vehicleEmoji} ${formatVehicleHeader(name, toNumber)}`,
    ...extraLines,
    ...formatLocationTime(location, eventTime),
  );
}

export function formatIgnitionOffAlert(name, fuel, location, eventTime, toNumber = null, driver = null) {
  const driverText = typeof driver === 'string' && driver.trim() && !driver.trim().startsWith('{') ? driver.trim() : null;
  const vehicleEmoji = getVehicleEmoji(name);
  return formatAlert(
    `🔴 IGNITION OFF - ${vehicleEmoji} ${formatVehicleHeader(name, toNumber)}`,
    `📍 ${location}`,
    `⛽ Fuel: ${formatFuelLiters(fuel)}`,
    `👤 Driver: ${driverText || 'Unassigned'}`,
    `🕘 ${formatEventTime(eventTime)}`,
  );
}

export function formatMotionAlert(name, location, eventTime, toNumber = null, driver = null) {
  const extraLines = [];
  const driverText = typeof driver === 'string' && driver.trim() && !driver.trim().startsWith('{') ? driver.trim() : null;
  extraLines.push(`👤 Driver: ${driverText || 'Unassigned'}`);
  const vehicleEmoji = getVehicleEmoji(name);
  return formatAlert(`🟢 MOTION STARTED - ${vehicleEmoji} ${formatVehicleHeader(name, toNumber)}`, ...extraLines, ...formatLocationTime(location, eventTime));
}

export function formatLocationUpdateAlert(name, speed, fuel, location, eventTime, toNumber = null, driver = null) {
  const extraLines = [];
  const driverText = typeof driver === 'string' && driver.trim() && !driver.trim().startsWith('{') ? driver.trim() : null;
  extraLines.push(`👤 Driver: ${driverText || 'Unassigned'}`);
  const vehicleEmoji = getVehicleEmoji(name);
  return formatAlert(
    `🗺 LOCATION UPDATE - ${vehicleEmoji} ${formatVehicleHeader(name, toNumber)}`,
    `📍 ${location}`,
    `⚡ Speed: ${formatSpeed(speed)} km/h`,
    `⛽ Fuel: ${formatFuelLiters(fuel)}`,
    ...extraLines,
    `🕘 ${formatEventTime(eventTime)}`,
  );
}

export function formatIdleAlert(name, location, eventTime, toNumber = null, driver = null) {
  const extraLines = [];
  const driverText = typeof driver === 'string' && driver.trim() && !driver.trim().startsWith('{') ? driver.trim() : null;
  extraLines.push(`👤 Driver: ${driverText || 'Unassigned'}`);
  const vehicleEmoji = getVehicleEmoji(name);
  return formatAlert(`⏱ IDLING - ${vehicleEmoji} ${formatVehicleHeader(name, toNumber)}`, ...extraLines, ...formatLocationTime(location, eventTime));
}

export function formatIdlingTooLongAlert(name, idleMinutes, fuel, location, eventTime, toNumber = null, driver = null) {
  const extraLines = [];
  const driverText = typeof driver === 'string' && driver.trim() && !driver.trim().startsWith('{') ? driver.trim() : null;
  extraLines.push(`👤 Driver: ${driverText || 'Unassigned'}`);
  const vehicleEmoji = getVehicleEmoji(name);
  return formatAlert(
    `⏱ IDLING TOO LONG - ${vehicleEmoji} ${formatVehicleHeader(name, toNumber)}`,
    `⏱ Idling for ${formatMinutes(idleMinutes)}`,
    `⛽ Fuel: ${formatFuelLiters(fuel)}`,
    ...extraLines,
    ...formatLocationTime(location, eventTime),
  );
}

export function formatFuelAlert(name, fuel, location, eventTime, toNumber = null, driver = null) {
  const extraLines = [];
  const driverText = typeof driver === 'string' && driver.trim() && !driver.trim().startsWith('{') ? driver.trim() : null;
  extraLines.push(`👤 Driver: ${driverText || 'Unassigned'}`);
  const vehicleEmoji = getVehicleEmoji(name);
  return formatAlert(
    `⛽ FUEL LOW - ${vehicleEmoji} ${formatVehicleHeader(name, toNumber)}`,
    `Fuel: ${formatFuelLiters(fuel)} (Warning below ${LOW_FUEL_LITERS} L)`,
    ...extraLines,
    ...formatLocationTime(location, eventTime),
  );
}

// ── Telegram ──────────────────────────────────────────────────

export async function sendTelegram(message) {
  const { BOT_TOKEN, CHAT_ID } = process.env;
  if (!BOT_TOKEN || !CHAT_ID) {
    console.log('Missing Telegram config - BOT_TOKEN or CHAT_ID not set');
    return { ok: false, error: 'missing_telegram_config' };
  }

  const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ chat_id: CHAT_ID, text: message }),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) console.log('Telegram error:', response.status, result);
  return result;
}

// ── Alert Dispatch ────────────────────────────────────────────

function normalizeAlert(entry) {
  if (typeof entry === 'string') return { type: 'message', message: entry, vehicle_id: null, location: null, speed: null, fuel: null };
  if (!entry || typeof entry !== 'object') return null;
  return {
    type: entry.type || 'message',
    message: entry.message,
    vehicle_id: entry.vehicle_id ?? null,
    location: entry.location ?? null,
    speed: entry.speed ?? null,
    fuel: entry.fuel ?? null,
    eventType: entry.eventType ?? null,
    coordinates: entry.coordinates ?? null,
    ignition: entry.ignition ?? null,
    driver: entry.driver ?? null,
    to_number: entry.to_number ?? null,
    timestamp: entry.timestamp ?? null,
    plate: entry.plate ?? null,
  };
}

let postgresPool = null;
let loggedPostgresTarget = false;

function getSafeDatabaseTarget(connectionString) {
  if (!connectionString) return 'DATABASE_URL is not set';
  try {
    const parsed = new URL(connectionString);
    return `host=${parsed.hostname || 'unknown'} port=${parsed.port || 'default'} database=${parsed.pathname.replace(/^\//, '') || 'unknown'}`;
  } catch {
    return 'DATABASE_URL is set but could not be parsed';
  }
}

function getPostgresPool() {
  const { DATABASE_URL } = process.env;
  if (!DATABASE_URL) throw new Error('DATABASE_URL is not set');
  if (!postgresPool) {
    if (!loggedPostgresTarget) {
      console.log(`[tracker-db] PostgreSQL target: ${getSafeDatabaseTarget(DATABASE_URL)}`);
      loggedPostgresTarget = true;
    }
    postgresPool = new pg.Pool({
      connectionString: DATABASE_URL,
      max: 3,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    postgresPool.on('error', (error) => {
      console.error('[tracker-db] Unexpected PostgreSQL pool error:', error.message);
    });
  }
  return postgresPool;
}

function canonicalEventType(eventType) {
  const raw = String(eventType || '');
  let result;
  switch (raw) {
    case 'IGNITION ON ALERT':
    case 'IGNITION_ON':
      result = 'IGNITION_ON';
      break;
    case 'IGNITION OFF ALERT':
    case 'IGNITION_OFF':
      result = 'IGNITION_OFF';
      break;
    case 'MOVING ALERT':
    case 'MOTION_STARTED':
      result = 'MOTION_STARTED';
      break;
    case 'IDLING ALERT':
    case 'IDLING TOO LONG ALERT':
    case 'IDLING':
    case 'IDLING_TOO_LONG':
      result = 'IDLING';
      break;
    case 'LOCATION UPDATE ALERT':
    case 'LOCATION UPDATE':
    case 'LOCATION_UPDATE':
      result = 'LOCATION_UPDATE';
      break;
    case 'NO_APPROVED_TRAVEL_ORDER':
      result = 'NO_APPROVED_TRAVEL_ORDER';
      break;
    case 'SPEEDING ALERT':
    case 'SPEEDING':
      result = 'SPEEDING';
      break;
    case 'LOW FUEL ALERT':
    case 'LOW_FUEL':
      result = 'LOW_FUEL';
      break;
    default:
      result = raw.toUpperCase() === 'MESSAGE' ? 'TELEGRAM_MESSAGE' : raw;
      break;
  }
  if (raw !== result) {
    console.log('[EVENT NORMALIZED]', { incoming: raw, saved: result });
  }
  return result;
}

function eventTypeFromAlert(alert) {
  const eventType = alert.eventType || ALERT_TYPE_TO_EVENT_TYPE[alert.type] || alert.type || 'message';
  return canonicalEventType(eventType);
}

function recordedAtFromAlert(alert) {
  const parsed = new Date(alert.timestamp || '');
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

async function insertGpsTelemetry(alert) {
  void alert;
  console.log('[tracker] gps_telemetry persistence is handled by backend insertTelemetry(); skipping tracker direct INSERT');
  return null;
}

export async function sendVehicleAlerts(alerts) {
  const result = { queued: alerts.length, sent: 0, skipped: 0, failed: 0, persisted: 0 };
  if (!alerts.length) return result;
  const nowMs = Date.now();
  for (const raw of alerts) {
    const alert = normalizeAlert(raw);
    if (!alert?.message) continue;
    if (await alreadySentRecently(alert.message, nowMs, ALERT_DEDUPE_SECONDS)) {
      result.skipped += 1;
      continue;
    }

    const telemetryId = await insertGpsTelemetry(alert);

    console.log(`[tracker] Before Telegram send telemetry_id=${telemetryId}`);
    const telegram = await sendTelegram(alert.message);
    if (telegram?.ok) {
      result.sent += 1;
      console.log(`[tracker] Telegram send succeeded telemetry_id=${telemetryId}`);
    } else {
      result.failed += 1;
      console.error(`[tracker] Telegram send failed telemetry_id=${telemetryId}: ${telegram?.error ?? 'telegram_not_ok'}`);
    }
  }
  return result;
}

// ── Cartrack API ──────────────────────────────────────────────

export async function getFleetData() {
  const { CARTRACK_API_URL, CARTRACK_USERNAME, CARTRACK_PASSWORD } = process.env;
  if (!CARTRACK_API_URL) throw new Error('Missing CARTRACK_API_URL');
  const auth = Buffer.from(`${CARTRACK_USERNAME}:${CARTRACK_PASSWORD}`).toString('base64');
  let lastError;

  for (let attempt = 0; attempt <= CARTRACK_RETRIES; attempt += 1) {
    try {
      const response = await fetchWithTimeout(CARTRACK_API_URL, {
        headers: { authorization: `Basic ${auth}` },
      });
      if (!response.ok) throw new Error(`Cartrack API error ${response.status}: ${await response.text()}`);
      return response.json();
    } catch (error) {
      lastError = error;
      if (!isRetriableFetchError(error) || attempt >= CARTRACK_RETRIES) break;
      await delay(500 * (attempt + 1));
    }
  }

  throw lastError;
}

export async function getFleetDataCached() {
  const ttl = FLEET_CACHE_SECONDS;
  const cached = await getJson('fleet:cache', null);
  if (cached?.timestamp && Date.now() - cached.timestamp < ttl * 1000) return cached.data;

  try {
    const data = await getFleetData();
    const value = { data, timestamp: Date.now() };
    await setJson('fleet:cache', value, ttl);
    await setJson('fleet:cache:last', value, FLEET_STALE_CACHE_SECONDS);
    return data;
  } catch (error) {
    const stale = await getJson('fleet:cache:last', null);
    if (stale?.data) {
      console.warn('Cartrack API unavailable; using cached fleet data:', error.message);
      return stale.data;
    }
    throw error;
  }
}

// ── Vehicle Extraction ────────────────────────────────────────

export function getVehicleId(vehicle) {
  return firstKey(vehicle, VEHICLE_ID_KEYS);
}

export function getVehicleName(vehicle) {
  return firstKey(vehicle, PLATE_NUMBER_KEYS) || getVehicleId(vehicle) || 'Vehicle';
}

export function getVehicleModel(_vehicle) {
  // Vehicle model is read exclusively from the database.
  return null;
}

/**
 * Return the display name for a vehicle.
 * Uses the plate_number string stored/resolved from the database,
 * with the Travel Order number appended if an active link exists.
 */
export function getVehicleDisplayName(vehicle) {
  if (vehicle.to_display_name) return vehicle.to_display_name;
  const plate = extractPlateNumber(vehicle);
  const toNumber = getTravelOrderNumber(vehicle);
  return toNumber ? `${plate} (TO-${toNumber})` : `${plate}`;
}

/**
 * Extract the raw plate number string from a Cartrack vehicle payload.
 * This is the key used for strict database lookup.
 */
export function extractPlateNumber(vehicle) {
  return String(firstKey(vehicle, PLATE_NUMBER_KEYS) || getVehicleId(vehicle) || '').trim().toUpperCase();
}

export function getVehicleSpeed(vehicle) {
  return toNumber(firstKey(vehicle, ['speed', 'speed_kph', 'speedKph', 'speed_kmh', 'speedKmh', 'current_speed', 'currentSpeed']), 0);
}

export function getVehicleFuel(vehicle) {
  let fuelValue = firstNestedKey(vehicle, ['fuel_level', 'fuelLevel', 'tank_level', 'tankLevel', 'fuel']);
  if (fuelValue && typeof fuelValue === 'object' && !Array.isArray(fuelValue)) {
    fuelValue = firstKey(fuelValue, ['level', 'value', 'remaining', 'liters', 'litres', 'liter', 'litre']);
  }
  if (fuelValue === null || fuelValue === undefined) return null;
  return toNumber(fuelValue, null);
}

export function getVehicleFuelPercent(vehicle) {
  let value = firstNestedKey(vehicle, ['fuel_percent', 'fuelPercent', 'fuel_percentage', 'fuelPercentage', 'fuel_level_percentage', 'fuelLevelPercentage', 'fuel_tank_percentage', 'fuelTankPercentage', 'fuel_level_perc', 'fuelLevelPerc', 'fuel_perc', 'fuelPerc']);
  if (value && typeof value === 'object' && !Array.isArray(value)) value = firstKey(value, ['percent', 'percentage', 'value', 'remaining', 'fuel_percent', 'fuelPercent']);
  if (value === null || value === undefined) return null;
  const percent = toNumber(value, null);
  if (percent === null) return null;
  return percent > 0 && percent <= 1 ? percent * 100 : percent;
}

export function isLowFuel(fuelLiters) {
  return fuelLiters !== null && fuelLiters !== undefined && fuelLiters < LOW_FUEL_LITERS;
}

export function getVehicleIdleMinutes(vehicle) {
  const idleMinutes = firstKey(vehicle, ['idle_minutes', 'idling_minutes', 'idle_duration_minutes', 'idleDurationMinutes', 'idle_time_minutes', 'idleTimeMinutes']);
  if (idleMinutes !== null && idleMinutes !== undefined) return toNumber(idleMinutes, 0);
  const idleSeconds = firstKey(vehicle, ['idle_seconds', 'idling_seconds', 'idle_duration_seconds', 'idleDurationSeconds', 'idle_time_seconds', 'idleTimeSeconds']);
  if (idleSeconds !== null && idleSeconds !== undefined) return toNumber(idleSeconds, 0) / 60;
  return null;
}

export function getIdleStatus(ignition, moving, prev = {}, apiIdleMinutes = null) {
  if (!ignition || moving) return { idleStartedAt: null, idleMinutes: 0, idlingTooLong: false, idleAlertCount: 0, previousIdleAlertCount: 0 };

  const now = Date.now();
  let idleStartedAt;
  let idleMinutes;

  if (apiIdleMinutes !== null && apiIdleMinutes !== undefined) {
    idleMinutes = Math.max(0, toNumber(apiIdleMinutes, 0));
    idleStartedAt = now - idleMinutes * 60 * 1000;
  } else {
    idleStartedAt = prev.idle_started_at || now;
    idleMinutes = Math.max(0, (now - Number(idleStartedAt)) / 60000);
  }

  // Calculate how many thresholds were crossed previously based on stored idle_minutes
  // This ensures cumulative alert counting works correctly across sync cycles
  const previousIdleAlertCount = IDLE_ALERT_THRESHOLDS_MINUTES.filter(
    (threshold) => threshold <= Number(prev.idle_minutes || 0)
  ).length;

  const idleAlertCount = IDLE_ALERT_THRESHOLDS_MINUTES.filter((threshold) => idleMinutes >= threshold).length;
  const nextThreshold = IDLE_ALERT_THRESHOLDS_MINUTES[idleAlertCount] || null;
  const lastAlertThreshold = idleAlertCount > 0 ? IDLE_ALERT_THRESHOLDS_MINUTES[idleAlertCount - 1] : null;

  // Diagnostic logging
  console.log({
    vehicleId: prev.vehicle_id || 'unknown',
    idlingStartedAt: new Date(Number(idleStartedAt)).toISOString(),
    elapsedMinutes: Math.round(idleMinutes * 10) / 10,
    lastAlertThreshold,
    nextThreshold,
    idleAlertCount,
    previousIdleAlertCount,
  });

  return { idleStartedAt, idleMinutes, idlingTooLong: idleMinutes >= IDLE_LIMIT_MINUTES, idleAlertCount, previousIdleAlertCount };
}

export function looksLikeVehicle(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return false;
  const hasIdentity = firstKey(record, [...VEHICLE_ID_KEYS, ...PLATE_NUMBER_KEYS]) !== null;
  if (!hasIdentity) return false;
  return !VEHICLE_LIST_KEYS.some((key) => Array.isArray(record[key]));
}

export function extractVehicles(payload) {
  const vehicles = [];
  const seen = new Set();

  function addVehicle(vehicle) {
    const vehicleId = getVehicleId(vehicle) || getVehicleName(vehicle) || Math.random();
    const key = String(vehicleId);
    if (seen.has(key)) return;
    seen.add(key);
    vehicles.push(vehicle);
  }

  function scan(value) {
    if (Array.isArray(value)) return value.forEach(scan);
    if (!value || typeof value !== 'object') return;

    for (const key of VEHICLE_LIST_KEYS) {
      if (value[key] !== undefined && value[key] !== null) scan(value[key]);
    }

    if (looksLikeVehicle(value)) return addVehicle(value);

    for (const nested of Object.values(value)) {
      if (nested && typeof nested === 'object') scan(nested);
    }
  }

  scan(payload);
  return vehicles;
}

export function getVehicleTime(vehicle) {
  return firstPresent(vehicle.event_time, vehicle.event_ts, vehicle.timestamp, vehicle.time, vehicle.gps_time, vehicle.gpsTime, vehicle.server_time, vehicle.serverTime, vehicle.recorded_at, vehicle.recordedAt, vehicle.last_update, vehicle.updated_at, new Date().toISOString());
}

export function getIgnition(vehicle) {
  return toBool(firstPresent(vehicle.ignition, vehicle.engine, vehicle.engine_on, vehicle.engine_status, vehicle.ignition_status, vehicle.acc), false);
}

// ── Reverse Geocoding ─────────────────────────────────────────

export async function reverseGeocode(latitude, longitude) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1`;
    const response = await fetch(url, { headers: { 'user-agent': 'CarTracker/1.0' } });
    if (!response.ok) return null;
    const data = await response.json();
    const address = data.address || {};
    const parts = [];
    const road = address.road || address.highway || address.pedestrian || address.path;
    const suburb = address.suburb || address.neighbourhood || address.residential;
    const city = address.city || address.town || address.municipality;
    if (road) parts.push(road);
    if (suburb) parts.push(suburb);
    if (city) parts.push(city);
    if (parts.length) return parts.join(', ');
    if (data.display_name) return data.display_name.split(',').slice(0, 3).join(',').trim();
  } catch (error) {
    console.log('Reverse geocoding failed:', error.message);
  }
  return null;
}

function parseCoordinateString(value) {
  const match = String(value || '').trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

export function getVehicleCoordinates(vehicle) {
  let location = firstPresent(vehicle.location, vehicle.position, vehicle.current_position, vehicle.gps, {});
  if (typeof location === 'string') {
    const coordinates = parseCoordinateString(location);
    if (coordinates) return coordinates;
  }
  if (!location || typeof location !== 'object' || Array.isArray(location)) location = {};
  const latitude = firstPresent(vehicle.latitude, vehicle.lat, location.latitude, location.lat);
  const longitude = firstPresent(vehicle.longitude, vehicle.lng, vehicle.lon, location.longitude, location.lng, location.lon);
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { latitude: lat, longitude: lng };
}

export async function getVehicleLocation(vehicle) {
  let location = firstPresent(vehicle.location, vehicle.position, vehicle.current_position, vehicle.gps, {});
  if (location && typeof location === 'object' && !Array.isArray(location)) {
    if (location.position_description) return String(location.position_description);
    const latitude = firstPresent(location.latitude, location.lat);
    const longitude = firstPresent(location.longitude, location.lng, location.lon);
    if (latitude !== undefined && longitude !== undefined) {
      const street = await reverseGeocode(Number(latitude), Number(longitude));
      return street || `${latitude}, ${longitude}`;
    }
  }
  if (typeof location === 'string') {
    const coordinates = parseCoordinateString(location);
    if (coordinates) {
      const street = await reverseGeocode(coordinates.latitude, coordinates.longitude);
      return street || location;
    }
    return location;
  }
  if (!location || typeof location !== 'object') location = {};
  const latitude = firstPresent(vehicle.latitude, vehicle.lat, location.latitude, location.lat);
  const longitude = firstPresent(vehicle.longitude, vehicle.lng, vehicle.lon, location.longitude, location.lng, vehicle.lon);
  const locationName = firstPresent(vehicle.location_name, vehicle.position_description, vehicle.location_description, vehicle.area, location.location_name, location.position_description, location.location_description, location.area, location.name, location.label, location.description, location.address);
  if (locationName) return String(locationName);
  if (latitude !== undefined && longitude !== undefined) {
    const street = await reverseGeocode(Number(latitude), Number(longitude));
    return street || `${latitude}, ${longitude}`;
  }
  return 'Location unavailable';
}

export function getTravelOrderNumber(vehicle) {
  return firstKey(vehicle, ['to_number', 'toNumber', 'travel_order_number', 'travelOrderNumber']);
}

export function getDriver(vehicle) {
  const raw = firstKey(vehicle, ['driver', 'driver_name', 'driverName', 'assigned_driver', 'assignedDriver']);
  // Cartrack sometimes returns driver as an object { name: "..." } instead of a plain string
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw.name || raw.full_name || raw.display_name || raw.label || null;
  }
  const str = raw ? String(raw).trim() : '';
  return str && !str.startsWith('{') ? str : null;
}

// ── Vehicle Status Builder ────────────────────────────────────

export async function buildVehicleStatus(vehicle) {
  const speed = getVehicleSpeed(vehicle);
  const fuel = getVehicleFuel(vehicle);
  const idleMinutes = getVehicleIdleMinutes(vehicle);
  const ignition = getIgnition(vehicle);
  return {
    id: getVehicleId(vehicle) || getVehicleName(vehicle),
    name: getVehicleDisplayName(vehicle),
    model: getVehicleModel(vehicle),
    coordinates: getVehicleCoordinates(vehicle),
    ignition,
    location: await getVehicleLocation(vehicle),
    time: formatEventTime(getVehicleTime(vehicle)),
    speed,
    speeding: speed >= SPEED_LIMIT_KMH,
    speed_limit: SPEED_LIMIT_KMH,
    fuel,
    fuel_liters: fuel,
    fuel_percent: getVehicleFuelPercent(vehicle),
    low_fuel: isLowFuel(fuel),
    low_fuel_liters: LOW_FUEL_LITERS,
    idle_minutes: idleMinutes,
    idling_too_long: ignition && speed <= 0 && idleMinutes !== null && idleMinutes >= IDLE_LIMIT_MINUTES,
    idle_limit_minutes: IDLE_LIMIT_MINUTES,
    to_number: getTravelOrderNumber(vehicle),
    driver: getDriver(vehicle),
  };
}

// ── Main Orchestrator ─────────────────────────────────────────

/**
 * Main fleet sync & alert orchestration function.
 *
 * Fetches fleet data from Cartrack, processes each vehicle's
 * telemetry state, generates and dispatches alerts, and returns
 * a structured summary of the cycle.
 *
 * @returns {Promise<{ status: string, vehicles: number, alerts: { queued: number, sent: number, skipped: number, failed: number, persisted: number }, data: Array<object>, emittedAlerts: Array<object> }>}
 */
/**
 * @param {Object} [options]
 * @param {(plateNumber: string) => Promise<string|null>} [options.resolveVehicleId]
 *   Optional callback to resolve a plate number to a database vehicle UUID.
 *   When provided, this is used instead of the built-in Supabase lookup.
 */
export async function syncFleetAndAlert(options = {}) {
  const {
    resolveVehicleId: resolveFn,
    driverOverrides = {},
    toNumberOverrides = {},
    noToVehicleIds = [],
    toDestinationOverrides = {},
    dispatchAlerts = true,
  } = options;
  const data = await getFleetDataCached();
  const vehicles = extractVehicles(data);
  const vehicleStatuses = [];
    const tripLogRecords = [];
    const alertSummary = { queued: 0, sent: 0, skipped: 0, failed: 0, persisted: 0 };
    const tripAlerts = [];
    const allEmittedAlerts = [];

  for (const vehicle of vehicles) {
    // ── Strict plate number resolution ────────────────────────
    // Extract the raw plate number from the Cartrack payload
    // and validate it against our database BEFORE processing.
    const plateNumber = extractPlateNumber(vehicle);
    if (!plateNumber) {
      console.log('Skipping vehicle with no plate number in payload');
      continue;
    }

    // ── Diagnostic: Capture raw telemetry for KAR6558 ────────
    if (plateNumber === 'KAR6558') {
      console.log('[DIAGNOSTIC] Raw telemetry payload for KAR6558:', JSON.stringify({
        plate: plateNumber,
        speed: vehicle.speed,
        ignition: vehicle.ignition,
        engine: vehicle.engine,
        engineStatus: vehicle.engine_status,
        status: vehicle.status,
        engine_on: vehicle.engine_on,
        ignition_status: vehicle.ignition_status,
        acc: vehicle.acc,
        vehicle_id: vehicle.vehicle_id,
        unit_id: vehicle.unit_id,
        timestamp: vehicle.positionTime || vehicle.event_time || vehicle.gps_time || vehicle.server_time,
        raw_keys: Object.keys(vehicle),
      }, null, 2));
    }

    const resolvedVehicleId = resolveFn
      ? await resolveFn(plateNumber)
      : await findVehicleIdByPlate(plateNumber);
    if (!resolvedVehicleId) {
      // Plate number does not exist in our vehicles table — skip entirely.
      // Do not attempt to guess or auto-create metadata.
      console.log(`Skipping unknown plate "${plateNumber}" — not found in database`);
      continue;
    }

    const vid = resolvedVehicleId;
    // Apply TO number override before display name is computed
    const overrideToNumber = toNumberOverrides[vid];
    if (overrideToNumber) {
      const plate = extractPlateNumber(vehicle);
      vehicle.to_display_name = `${plate} (${overrideToNumber})`;
    } else if (noToVehicleIds.includes(vid)) {
      // Vehicle has NO approved travel order for today
      const plate = extractPlateNumber(vehicle);
      vehicle.to_display_name = `${plate} (⚠️ No TO)`;
    }
    const name = getVehicleDisplayName(vehicle);
    const ignition = getIgnition(vehicle);
    const speed = getVehicleSpeed(vehicle);
    const fuel = getVehicleFuel(vehicle);
    const fuelPercent = getVehicleFuelPercent(vehicle);
    const location = await getVehicleLocation(vehicle);
    const eventTime = getVehicleTime(vehicle);
    const formattedEventTime = formatEventTime(eventTime);
    const speeding = speed >= SPEED_LIMIT_KMH;
    const lowFuel = isLowFuel(fuel);
    const rawPrev = await getJson(`vehicle:${vid}`, null);
    const prev = rawPrev && typeof rawPrev === 'string' ? JSON.parse(rawPrev) : rawPrev || {};
    const hasPreviousState = rawPrev !== null && rawPrev !== undefined;
    const prevIgnition = toBool(prev.ignition, false);
    const prevSpeeding = toBool(prev.speeding, false);
    const prevLowFuel = toBool(prev.low_fuel, false);
    const prevMoving = toBool(prev.moving, false);
    const prevIdlingTooLong = toBool(prev.idling_too_long, false);
    const moving = speed > 0;
    const idle = getIdleStatus(ignition, moving, prev, getVehicleIdleMinutes(vehicle));
    const toNumber = getTravelOrderNumber(vehicle);
    const driver = driverOverrides[vid] || getDriver(vehicle);
    const coordinates = getVehicleCoordinates(vehicle);

    const alerts = [];
    const vehicleEmittedAlerts = [];
    function pushAlert(type, message, eventType = null, extra = {}) {
      if (!eventType) {
        eventType = ALERT_TYPE_TO_EVENT_TYPE[type] || null;
      }
      const alert = {
        type,
        message,
        vehicle_id: vid,
        location,
        speed,
        fuel,
        ignition,
        eventType,
        coordinates,
        driver,
        to_number: toNumber,
        timestamp: eventTime,
        plate: plateNumber,
        ...extra,
      };
      console.log("[TRACKER ALERT]", {
        vehicle: plateNumber,
        eventType,
        tripId: alert.tripId ?? null,
        telemetryEvent: type,
        alert
      });
      alerts.push(alert);
      if (eventType) {
        vehicleEmittedAlerts.push(alert);
      }
    }

    // ── Trip State Alerts (origin/destination tracking, ignition/idling) ──
    const coordinates_ = getVehicleCoordinates(vehicle);
    const toDestCoord = toDestinationOverrides[vid] || null;
    const tripStateAlerts = await processTripState(vehicle, vid, coordinates_?.latitude ?? null, coordinates_?.longitude ?? null, toDestCoord);
    let tripStateFiredIgnition = false;
    const tripStateIgnitionOn = tripStateAlerts.some((a) => a.type === 'IGNITION_ON');
    const tripStateIgnitionOff = tripStateAlerts.some((a) => a.type === 'IGNITION_OFF');
    tripStateAlerts.forEach((a) => {
      // Replace generic trip state ignition messages with properly formatted ones
      let message = a.message;
      if (a.type === 'IGNITION_ON') {
        message = formatIgnitionAlert(name, true, location, eventTime, toNumber, driver);
        tripStateFiredIgnition = true;
        pushAlert('trip_state', message, 'IGNITION_ON', { tripId: a.tripId ?? null });
      } else if (a.type === 'IGNITION_OFF') {
        message = formatIgnitionOffAlert(name, fuel, location, eventTime, toNumber, driver);
        tripStateFiredIgnition = true;
        pushAlert('trip_state', message, 'IGNITION_OFF', { tripId: a.tripId ?? null });
      }
      tripAlerts.push({ ...a, vehicle_id: vid, message });
    });

    const originData = consumeOrigin(vid);
    const destinationData = consumeDestination(vid);

    if (hasPreviousState) {
      const ignitionChanged = ignition !== prevIgnition;
      let idlingAlertEmitted = false;
      let motionAlertEmitted = false;

      if (ignitionChanged && !tripStateFiredIgnition) {
        const eventType = ignition ? 'IGNITION_ON' : 'IGNITION_OFF';
        const message = eventType === 'IGNITION_OFF' 
          ? formatIgnitionOffAlert(name, fuel, location, eventTime, toNumber, driver)
          : formatIgnitionAlert(name, ignition, location, eventTime, toNumber, driver);
        pushAlert('ignition', message, eventType);
      }
      if (ignition && speeding && !prevSpeeding) pushAlert('speeding', formatSpeedingAlert(name, speed, location, eventTime, toNumber, driver));
      if (lowFuel && !prevLowFuel) pushAlert('low_fuel', formatFuelAlert(name, fuel, location, eventTime, toNumber, driver));
      if (idle.idlingTooLong && idle.idleAlertCount > idle.previousIdleAlertCount) {
        const thresholdReached =
          idle.idleAlertCount > 0
            ? IDLE_ALERT_THRESHOLDS_MINUTES[idle.idleAlertCount - 1] ?? null
            : null;

        if (thresholdReached == null) {
          console.warn('[idling-alert-skip] missing threshold', {
            vehicleId: vid,
            activeTripId: prev.activeTripId,
            idleAlertCount: idle.idleAlertCount,
            previousIdleAlertCount: idle.previousIdleAlertCount,
            idleMinutes: idle.idleMinutes,
          });
        }

        idlingAlertEmitted = true;
        pushAlert('idling_too_long', formatIdlingTooLongAlert(name, idle.idleMinutes, fuel, location, eventTime, toNumber, driver));
      }
      if (ignition && moving && !prevMoving && prevIdlingTooLong) {
        motionAlertEmitted = true;
        pushAlert('motion', formatMotionAlert(name, location, eventTime, toNumber, driver));
      }
      if (
        ignition &&
        moving &&
        location !== prev.location &&
        !tripStateFiredIgnition &&
        !ignitionChanged &&
        !idlingAlertEmitted &&
        !motionAlertEmitted
      ) {
        pushAlert('location_update', formatLocationUpdateAlert(name, speed, fuel, location, eventTime, toNumber, driver));
      }
    } else if (ignition) {
      if (speeding) pushAlert('speeding', formatSpeedingAlert(name, speed, location, eventTime, toNumber, driver));
      if (lowFuel) pushAlert('low_fuel', formatFuelAlert(name, fuel, location, eventTime, toNumber, driver));
      if (idle.idlingTooLong) pushAlert('idling_too_long', formatIdlingTooLongAlert(name, idle.idleMinutes, fuel, location, eventTime, toNumber, driver));
    }

    if (dispatchAlerts) {
      const alertResult = await sendVehicleAlerts(alerts);
      alertSummary.queued += alertResult.queued;
      alertSummary.sent += alertResult.sent;
      alertSummary.skipped += alertResult.skipped;
      alertSummary.failed += alertResult.failed;
      alertSummary.persisted += alertResult.persisted || 0;
    } else {
      alertSummary.queued += alerts.length;
    }

    const state = {
      ignition,
      moving,
      fuel,
      fuel_percent: fuelPercent,
      low_fuel: lowFuel,
      speed,
      speeding,
      location,
      time: formattedEventTime,
      idle_started_at: idle.idleStartedAt,
      idle_minutes: idle.idleMinutes,
      idling_too_long: idle.idlingTooLong,
      idling_too_long_alert_count: idle.idleAlertCount,
      idling_too_long_alert_threshold_count: idle.idleAlertCount,
    };
    // Store vehicle state with a long TTL (24 hours) so that idle
    // tracking, ignition state, and other stateful detections persist
    // across sync cycles. Using the default TTL (600s) would cause
    // the state to expire before the idling-too-long threshold (10min
    // or more) is reached, breaking idle alerts.
    await setJson(`vehicle:${vid}`, state, 86400);

    vehicleStatuses.push({
      id: vid,
      plateNumber,
      name,
      model: getVehicleModel(vehicle),
      coordinates: getVehicleCoordinates(vehicle),
      latitude: coordinates_?.latitude ?? null,
      longitude: coordinates_?.longitude ?? null,
      location,
      time: formattedEventTime,
      eventTime,
      speed,
      speeding,
      ignition,
      speed_limit: SPEED_LIMIT_KMH,
      fuel,
      fuel_liters: fuel,
      fuel_percent: fuelPercent,
      low_fuel: lowFuel,
      low_fuel_liters: LOW_FUEL_LITERS,
      idle_minutes: idle.idleMinutes,
      idling_too_long: idle.idlingTooLong,
      idle_limit_minutes: IDLE_LIMIT_MINUTES,
      idle_alert_count: idle.idleAlertCount,
      driver,
      toNumber,
    });

    // Build trip log record for this vehicle
    const vehicleStatusForLog = {
      speed,
      speeding,
      low_fuel: lowFuel,
      location,
      driver,
      to_number: toNumber,
    };
    // Attach origin/destination coordinates from trip state tracker
    const originCoord = originData?.originCoordinate || (coordinates ? `${coordinates.latitude.toFixed(5)},${coordinates.longitude.toFixed(5)}` : '');
    const destinationCoord = destinationData?.destinationCoordinate || '';
    const arrivalTimeGps = destinationData?.arrivalTime || null;

    const tripLogRecord = buildTripLogRecord(vehicle, vehicleStatusForLog, location);
    tripLogRecords.push({
      ...tripLogRecord,
      vehicleId: vid,
      originGpsStartPoint: originCoord || tripLogRecord.originGpsStartPoint,
      destinationGpsEndPoint: destinationCoord || tripLogRecord.destinationGpsEndPoint,
      arrivalTimeGps: arrivalTimeGps || tripLogRecord.arrivalTimeGps,
    });

    // Collect emitted alerts for this vehicle (with canonical event types)
    for (const ea of vehicleEmittedAlerts) {
      allEmittedAlerts.push({
        vehicleId: vid,
        vehicleName: name,
        plateNumber: plateNumber,
        eventType: ea.eventType,
        latitude: coordinates?.latitude ?? null,
        longitude: coordinates?.longitude ?? null,
        location: ea.location,
        speed: ea.speed,
        fuel: ea.fuel,
        ignition: ea.ignition,
        driver: ea.driver,
        toNumber: ea.to_number,
        tripId: ea.tripId ?? null,
        timestamp: ea.timestamp,
        message: ea.message,
        // Include idling milestone info for deduplication
        idleAlertCount: ea.eventType === 'IDLING' ? idle.idleAlertCount : undefined,
        idlingThresholdReached:
          ea.eventType === 'IDLING'
            ? idle.idleAlertCount > 0
              ? IDLE_ALERT_THRESHOLDS_MINUTES[idle.idleAlertCount - 1] ?? null
              : null
            : undefined,
        idlingStartedAt: ea.eventType === 'IDLING' ? idle.idleStartedAt : undefined,
      });
    }
  }

  // Trip-state alerts are already included in each vehicle's alert batch.
  void tripAlerts;

  return { status: 'ok', vehicles: vehicles.length, alerts: alertSummary, data: vehicleStatuses, tripLogs: tripLogRecords, emittedAlerts: allEmittedAlerts };
}
