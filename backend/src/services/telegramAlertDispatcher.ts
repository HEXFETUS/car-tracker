import { createHash } from 'node:crypto';
import type pg from 'pg';
import { sendTelegram, TELEGRAM_TIMEOUT_MS, type TelegramResponse } from '@car-tracker/tracker';
import { getPool } from '../db/db.js';
import { canonicalTelemetryEventType, insertTelemetry, type TelemetryInsert } from './gpsTelemetryService.js';

const PREFIX = 'phase1:';
const MAX_ATTEMPTS = 3;
type ClaimState = 'pending' | 'attempted' | 'retry' | 'unknown' | 'terminal';
interface Claim {
  version: 1;
  state: ClaimState;
  attempts: number;
  nextAttemptAt?: number;
  error?: string;
}
interface DeliveryRow {
  id: string;
  source_event_key: string | null;
  telegram_status: string | null;
  telegram_error: string | null;
  telegram_message: string | null;
}
export interface AlertDeliveryResult {
  eventId: string;
  telemetryId: string | null;
  saved: boolean;
  outcome: 'accepted' | 'suppressed' | 'deferred' | 'failed' | 'unknown';
  attemptedAt: string | null;
  messageId: number | null;
  chatId: number | null;
  telegramDate: number | null;
  finalized: boolean;
  error: string | null;
}
interface DispatchOptions { telemetryId?: string; deadlineAtMs?: number }
let sender = sendTelegram;
export function setTelegramAlertSenderForTest(fn: typeof sendTelegram | null): void {
  sender = fn ?? sendTelegram;
}

const compatibilityChecks = new WeakMap<pg.Pool, Promise<void>>();
/** Read-only and fail closed. No migrations or schema repair are performed. */
export async function ensureTelegramAlertCompatibility(pool = getPool()): Promise<void> {
  let check = compatibilityChecks.get(pool);
  if (!check) {
    check = (async () => {
      const columns = await pool.query<{ name: string; type: string }>(
        `SELECT attname AS name, format_type(atttypid, atttypmod) AS type
           FROM pg_attribute WHERE attrelid = 'gps_telemetry'::regclass
             AND attnum > 0 AND NOT attisdropped`,
      );
      const types = new Map(columns.rows.map(row => [row.name, row.type]));
      if (types.get('telegram_error') !== 'text'
        || !/^(text|character varying(?:\((?:[7-9]|[1-9][0-9]+)\))?)$/.test(types.get('telegram_status') ?? '')
        || types.get('source_event_key') !== 'text'
        || !types.has('telegram_attempted_at')) {
        throw new Error('Phase 1 delivery requires compatible existing telemetry columns; schema approval required');
      }
      const constraints = await pool.query<{ definition: string }>(
        `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
          WHERE conrelid = 'gps_telemetry'::regclass AND contype = 'c'`,
      );
      if (constraints.rows.some(row => /telegram_error/i.test(row.definition))) {
        throw new Error('Phase 1 claim metadata requires review of the existing telegram_error constraint');
      }
    })();
    compatibilityChecks.set(pool, check);
    check.catch(() => compatibilityChecks.delete(pool));
  }
  await check;
}

export function telegramEventIdentity(event: TelemetryInsert): string {
  const type = canonicalTelemetryEventType(event.eventType);
  const timestamp = type === 'IDLING_TOO_LONG' && event.idlingStartedAt
    ? event.idlingStartedAt : event.recordedAt;
  return createHash('sha256').update(JSON.stringify([
    event.vehicleId, type, new Date(timestamp).toISOString(), event.idlingThresholdMinutes ?? null,
  ])).digest('hex');
}
export function pendingTelegramClaim(): string {
  return encode({ version: 1, state: 'pending', attempts: 0 });
}
function encode(claim: Claim): string { return PREFIX + JSON.stringify(claim); }
function decode(value: string | null): Claim | null {
  if (!value?.startsWith(PREFIX)) return null;
  try {
    const claim = JSON.parse(value.slice(PREFIX.length)) as Claim;
    return claim.version === 1 && ['pending', 'attempted', 'retry', 'unknown', 'terminal'].includes(claim.state)
      && Number.isInteger(claim.attempts) && claim.attempts >= 0 && claim.attempts <= MAX_ATTEMPTS
      && (claim.state !== 'retry' || Number.isFinite(claim.nextAttemptAt)) ? claim : null;
  } catch { return null; }
}
function log(event: string, eventId: string, telemetryId: string | null, details: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ event, eventId, telemetryId, ...details }));
}
function validate(event: TelemetryInsert): void {
  if (!event.vehicleId || !event.plateNumber || !event.eventType || !event.telegramMessage?.trim()
    || !Number.isFinite(new Date(event.recordedAt).getTime())
    || (event.idlingStartedAt && !Number.isFinite(new Date(event.idlingStartedAt).getTime()))) {
    throw new Error('Invalid Telegram alert: vehicle, plate, event type, timestamp and message are required');
  }
}

/** Caller may supply a transaction that already holds the per-vehicle lock. */
export async function prepareTelegramAlert(event: TelemetryInsert, client: pg.PoolClient): Promise<{
  id: string | null; inserted: boolean; updated: boolean;
}> {
  validate(event);
  const eventKey = telegramEventIdentity(event);
  const exact = await client.query<{ id: string }>(
    'SELECT id FROM gps_telemetry WHERE source_event_key = $1 LIMIT 1', [eventKey],
  );
  if (exact.rows[0]) return { id: exact.rows[0].id, inserted: false, updated: false };
  return insertTelemetry({ ...event, sourceEventKey: eventKey, telegramStatus: null,
    telegramError: pendingTelegramClaim(), telegramAttemptedAt: null }, client, { includeSuppressedId: true });
}

export async function dispatchTelegramAlert(event: TelemetryInsert, options: DispatchOptions = {}): Promise<AlertDeliveryResult> {
  validate(event);
  const pool = getPool();
  await ensureTelegramAlertCompatibility(pool);
  let eventId = telegramEventIdentity(event);
  const result: AlertDeliveryResult = { eventId, telemetryId: options.telemetryId ?? null, saved: false,
    outcome: 'suppressed', attemptedAt: null, messageId: null, chatId: null, telegramDate: null,
    finalized: false, error: null };
  log('alert_detected', eventId, result.telemetryId);
  if (!options.telemetryId) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`telegram-alert:${event.vehicleId}`]);
      const prepared = await prepareTelegramAlert(event, client);
      await client.query('COMMIT');
      result.telemetryId = prepared.id;
      result.saved = prepared.inserted;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error; // Never send without confirmed durable preparation.
    } finally { client.release(); }
  }
  if (!result.telemetryId) {
    log('duplicate_suppressed', eventId, null);
    return result;
  }
  const fetched = await pool.query<DeliveryRow>(
    `SELECT id, source_event_key, telegram_status, telegram_error, telegram_message
       FROM gps_telemetry WHERE id = $1`, [result.telemetryId],
  );
  const row = fetched.rows[0];
  // A semantic duplicate or recovered row keeps its original durable identity.
  if (row?.source_event_key) { eventId = row.source_event_key; result.eventId = eventId; }
  const claim = decode(row?.telegram_error ?? null);
  result.finalized = row?.telegram_status === 'sent';
  if (!row || row.telegram_status === 'sent' || row.telegram_status === 'skipped'
    || !claim || !['pending', 'retry'].includes(claim.state) || claim.attempts >= MAX_ATTEMPTS) {
    log('duplicate_suppressed', eventId, result.telemetryId, {
      reason: !claim ? 'legacy_or_unrecognized_claim' : claim.state,
    });
    if (claim?.state === 'attempted' || claim?.state === 'unknown') {
      result.outcome = 'unknown'; result.error = 'delivery_outcome_unknown';
      log('unknown_delivery_outcome', eventId, result.telemetryId);
    }
    return result;
  }
  const dueAt = claim.nextAttemptAt ?? 0;
  // Do not hold a serverless request waiting for a future retry.
  if (dueAt > Date.now() || (options.deadlineAtMs && Date.now() + TELEGRAM_TIMEOUT_MS + 250 >= options.deadlineAtMs)) {
    result.outcome = 'deferred';
    log('retry_scheduled', eventId, result.telemetryId, { nextAttemptAt: dueAt || Date.now(), reason: 'deadline_or_backoff' });
    return result;
  }
  const attempted: Claim = { version: 1, state: 'attempted', attempts: claim.attempts + 1 };
  const token = encode(attempted);
  const attemptedAt = new Date().toISOString();
  const won = await pool.query<{ id: string }>(
    `UPDATE gps_telemetry SET telegram_error = $2, telegram_attempted_at = $3
      WHERE id = $1 AND telegram_error = $4
        AND telegram_status IS DISTINCT FROM 'sent' AND telegram_status IS DISTINCT FROM 'skipped'
      RETURNING id`, [row.id, token, attemptedAt, row.telegram_error],
  );
  if (!won.rows[0]) { log('duplicate_suppressed', eventId, row.id, { reason: 'claim_lost' }); return result; }
  result.attemptedAt = attemptedAt;
  log('telegram_delivery_attempted', eventId, row.id, { attempt: attempted.attempts });
  let response: TelegramResponse;
  try { response = await sender(row.telegram_message ?? event.telegramMessage!); }
  catch { response = { ok: false, outcome: 'unknown', error: 'telegram_network_outcome_unknown' }; }
  let next: Claim | null = null;
  if (response.ok === true) {
    // Acceptance remains acceptance even if receipt fields are unexpectedly absent.
    result.outcome = 'accepted';
    result.messageId = response.result?.message_id ?? null;
    result.chatId = response.result?.chat?.id ?? null;
    result.telegramDate = response.result?.date ?? null;
    log('telegram_delivery_confirmed', eventId, row.id, { messageId: result.messageId,
      chatId: result.chatId, telegramDate: result.telegramDate });
  } else {
    const rejected = response.outcome === 'rejected' && Number.isInteger(response.error_code);
    const retryable = rejected && (response.error_code === 429 || response.error_code! >= 500);
    result.outcome = rejected ? 'failed' : 'unknown';
    result.error = rejected ? `telegram_api_${response.error_code}` : 'delivery_outcome_unknown';
    next = { version: 1, state: rejected ? 'terminal' : 'unknown', attempts: attempted.attempts, error: result.error };
    if (retryable && attempted.attempts < MAX_ATTEMPTS) {
      next.state = 'retry';
      const retryAfter = Math.max(0, response.parameters?.retry_after ?? 0);
      next.nextAttemptAt = Date.now() + Math.max(1000 * 2 ** (attempted.attempts - 1), retryAfter * 1000);
      log('retry_scheduled', eventId, row.id, { nextAttemptAt: next.nextAttemptAt, attempt: next.attempts });
    }
    log(rejected ? 'telegram_delivery_failed' : 'unknown_delivery_outcome', eventId, row.id, { error: result.error });
  }
  // Retry database finalization only. The committed attempted token is never reclaimed.
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const finalized = await pool.query<{ id: string }>(
        `UPDATE gps_telemetry SET telegram_status = $2, telegram_error = $3
          WHERE id = $1 AND telegram_error = $4 AND telegram_attempted_at = $5 RETURNING id`,
        [row.id, result.outcome === 'accepted' ? 'sent' : 'failed', next ? encode(next) : null, token, attemptedAt],
      );
      result.finalized = Boolean(finalized.rows[0]);
      if (!result.finalized) result.error = result.error ?? 'delivery_finalization_not_confirmed';
      break;
    } catch {
      log('database_finalization_failed', eventId, row.id, { attempt: attempt + 1, accepted: result.outcome === 'accepted' });
      if (attempt === MAX_ATTEMPTS - 1 || (options.deadlineAtMs && Date.now() + 1000 * 2 ** attempt >= options.deadlineAtMs)) {
        result.error = result.error ?? 'delivery_status_update_failed'; break;
      }
      await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt));
    }
  }
  return result;
}

export async function retryPendingTelegramAlerts(options: { deadlineAtMs?: number } = {}): Promise<{ sent: number; failed: number }> {
  const pool = getPool();
  await ensureTelegramAlertCompatibility(pool);
  const rows = await pool.query<{
    id: string; vehicle_id: string; plate_number: string; event_type: string; recorded_at: string;
    telegram_message: string; telegram_error: string; idling_threshold_minutes: number | null;
  }>(
    `SELECT id, vehicle_id, plate_number, event_type, recorded_at, telegram_message,
            telegram_error, idling_threshold_minutes FROM gps_telemetry
      WHERE telegram_message IS NOT NULL
        AND telegram_status IS DISTINCT FROM 'sent' AND telegram_status IS DISTINCT FROM 'skipped'
        AND (telegram_error LIKE 'phase1:{"version":1,"state":"pending",%'
          OR telegram_error LIKE 'phase1:{"version":1,"state":"retry",%')
        AND COALESCE(substring(telegram_error FROM '"nextAttemptAt":([0-9]+)')::numeric, 0)
              <= extract(epoch FROM now()) * 1000
      ORDER BY telegram_attempted_at ASC NULLS FIRST, recorded_at ASC LIMIT 25`,
  );
  const summary = { sent: 0, failed: 0 };
  for (const row of rows.rows) {
    if (options.deadlineAtMs && Date.now() + TELEGRAM_TIMEOUT_MS + 250 >= options.deadlineAtMs) break;
    const delivered = await dispatchTelegramAlert({ vehicleId: row.vehicle_id, plateNumber: row.plate_number,
      eventType: row.event_type, recordedAt: row.recorded_at, telegramMessage: row.telegram_message,
      idlingThresholdMinutes: row.idling_threshold_minutes, latitude: null, longitude: null,
      ignition: false, speedKmh: 0, fuelLiters: null, locationName: null },
    { telemetryId: row.id, deadlineAtMs: options.deadlineAtMs });
    if (delivered.outcome === 'accepted') summary.sent++;
    else if (delivered.outcome === 'failed' || delivered.outcome === 'unknown') summary.failed++;
  }
  return summary;
}
