// ── Environment Configuration ─────────────────────────────────
//
// Centralised, typed access to all environment variables used
// across the backend. Every value is read once at import time.

/**
 * Normalise a string env value, trimming quotes that .env files
 * sometimes carry.
 */
function str(key: string, fallback = ''): string {
  const raw = process.env[key];
  if (!raw) return fallback;
  return raw.replace(/^["']|["']$/g, '').trim();
}

function num(key: string, fallback: number): number {
  const parsed = Number(str(key));
  return Number.isFinite(parsed) ? parsed : fallback;
}

// ── System / Server ───────────────────────────────────────────

export const PORT = num('PORT', 3500);
export const NODE_ENV = str('NODE_ENV', 'development');

// Authentication and browser origins. Production must provide a secret with
// enough entropy to prevent session-token forgery.
export const AUTH_SECRET = str('AUTH_SECRET');
export const APP_ORIGINS = str('APP_ORIGINS')
  .split(',')
  .map((origin) => origin.trim().replace(/\/$/, ''))
  .filter(Boolean);

if (NODE_ENV === 'production' && AUTH_SECRET.length < 32) {
  throw new Error('AUTH_SECRET must be configured with at least 32 characters in production');
}
if (NODE_ENV === 'production' && APP_ORIGINS.length === 0) {
  throw new Error('APP_ORIGINS must list at least one trusted browser origin in production');
}

if (NODE_ENV !== 'production' && AUTH_SECRET.length < 32) {
  console.warn('[security] AUTH_SECRET is missing or shorter than 32 characters; using a development-only secret');
}

// ── Telegram ──────────────────────────────────────────────────

export const BOT_TOKEN = str('BOT_TOKEN');
export const CHAT_ID = str('CHAT_ID');

// ── Cartrack ──────────────────────────────────────────────────

export const CARTRACK_USERNAME = str('CARTRACK_USERNAME');
export const CARTRACK_PASSWORD = str('CARTRACK_PASSWORD');
export const CARTRACK_API_URL = str('CARTRACK_API_URL');
export const SYNC_INTERVAL_SECONDS = num('SYNC_INTERVAL_SECONDS', 30);
export const GPS_TO_MATCH_TOLERANCE_MINUTES = num('GPS_TO_MATCH_TOLERANCE_MINUTES', 10);

/**
 * Tolerance in minutes for matching a GPS Driving event to a Travel Order
 * departure/return time. Falls back to 10 minutes.
 * Uses TO_DRIVING_MATCH_TOLERANCE_MINUTES environment variable.
 */
const rawTolerance = Number(process.env.TO_DRIVING_MATCH_TOLERANCE_MINUTES);
export const TO_DRIVING_MATCH_TOLERANCE_MINUTES_ENV: number =
  Number.isFinite(rawTolerance) && rawTolerance > 0
    ? rawTolerance
    : 10;

export const CRON_SECRET = str('CRON_SECRET');

/**
 * GPS destination coordinate validation threshold in meters.
 * When matching a trip end coordinate to a Travel Order destination,
 * if the haversine distance exceeds this threshold, the destination
 * is considered unverified but the trip is not rejected if detailed
 * fleet history is unavailable.
 * Default: 300 meters
 */
export const GPS_TO_DESTINATION_THRESHOLD_METERS = num('GPS_TO_DESTINATION_THRESHOLD_METERS', 300);

/**
 * When detailed fleet history is unavailable, allow using Cartrack trip summary
 * start/end times as fallback for GPS actual departure/arrival times.
 *   true  → use trip summary times, mark anomaly_flag=true, add fallback note
 *   false → leave departure_time_gps/arrival_time_gps null, mark anomaly_flag=true, add warning note
 * Default: false
 */
export const ALLOW_TRIP_SUMMARY_TIME_FALLBACK = str('ALLOW_TRIP_SUMMARY_TIME_FALLBACK', 'false').toLowerCase() === 'true';

// ── Database (Supabase / PostgreSQL) ──────────────────────────

export const DATABASE_URL = str('DATABASE_URL');

// ── Convenience helpers ───────────────────────────────────────

export const telegramConfigured = (): boolean => Boolean(BOT_TOKEN && CHAT_ID);
export const cartrackConfigured = (): boolean => Boolean(CARTRACK_USERNAME && CARTRACK_PASSWORD && CARTRACK_API_URL);
