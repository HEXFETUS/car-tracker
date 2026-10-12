import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type pg from 'pg';
import { sendTelegram } from '@car-tracker/tracker';
import { setPoolForTest } from '../db/db.js';
import type { TelemetryInsert } from './gpsTelemetryService.js';
import { dispatchTelegramAlert, pendingTelegramClaim, retryPendingTelegramAlerts,
  setTelegramAlertSenderForTest, telegramEventIdentity } from './telegramAlertDispatcher.js';

const alert: TelemetryInsert = {
  vehicleId: 'vehicle-1', plateNumber: 'TEST123', eventType: 'SPEEDING',
  recordedAt: '2026-10-12T04:00:00Z', telegramMessage: 'Existing formatted alert',
  latitude: 14, longitude: 121, speedKmh: 95, ignition: true, fuelLiters: 20, locationName: 'Road',
};
function mockDatabase(options: { legacy?: boolean; failClaim?: boolean; failFinalize?: boolean; failPrepare?: boolean } = {}) {
  const row = { id: 'row-1', telegram_status: null as string | null,
    telegram_error: options.legacy ? 'old failure' : pendingTelegramClaim(),
    telegram_message: alert.telegramMessage!, source_event_key: telegramEventIdentity(alert),
    telegram_attempted_at: null as string | null };
  const calls: string[] = [];
  const query = async (sql: string, params: unknown[] = []) => {
    calls.push(sql);
    if (sql.includes('FROM pg_attribute')) return { rows: [
      { name: 'telegram_error', type: 'text' }, { name: 'telegram_status', type: 'text' },
      { name: 'source_event_key', type: 'text' }, { name: 'telegram_attempted_at', type: 'timestamp with time zone' },
    ] };
    if (sql.includes('pg_constraint')) return { rows: [] };
    if (options.failPrepare && sql.includes('pg_advisory_xact_lock')) throw new Error('database offline');
    if (sql.includes('SELECT id FROM gps_telemetry')) return { rows: [{ id: row.id }] };
    if (sql.includes('SELECT id, source_event_key')) return { rows: [{ ...row }] };
    if (sql.includes('UPDATE gps_telemetry')) {
      if (sql.includes('SET telegram_status')) {
        if (options.failFinalize) throw new Error('database offline');
        if (row.telegram_error !== params[3]) return { rows: [] };
        row.telegram_status = params[1] as string;
        row.telegram_error = params[2] as string;
      } else {
        if (options.failClaim) throw new Error('database offline');
        if (row.telegram_error !== params[3]) return { rows: [] };
        row.telegram_error = params[1] as string;
        row.telegram_attempted_at = params[2] as string;
      }
      return { rows: [{ id: row.id }], rowCount: 1 };
    }
    if (sql.includes('LIMIT 25')) {
      return { rows: [{ ...row, vehicle_id: alert.vehicleId, plate_number: alert.plateNumber,
        event_type: alert.eventType, recorded_at: alert.recordedAt, idling_threshold_minutes: null }] };
    }
    return { rows: [] };
  };
  const pool = { query, connect: async () => ({ query, release() {} }) } as unknown as pg.Pool;
  return { pool, row, calls };
}
function claimOf(value: string | null) { return JSON.parse(value!.slice('phase1:'.length)); }

describe('durable Telegram dispatcher', () => {
  let sends = 0;
  beforeEach(() => {
    sends = 0;
    setTelegramAlertSenderForTest(async () => {
      sends++;
      return { ok: true, result: { message_id: 42, chat: { id: -123 }, date: 1791777600 } };
    });
  });
  afterEach(() => { setTelegramAlertSenderForTest(null); setPoolForTest(null); });

  it('returns acceptance receipt and finalizes only after the HTTP response', async () => {
    const db = mockDatabase(); setPoolForTest(db.pool);
    setTelegramAlertSenderForTest(async message => {
      sends++;
      assert.equal(message, alert.telegramMessage);
      assert.equal(claimOf(db.row.telegram_error).state, 'attempted');
      assert.equal(db.row.telegram_status, null);
      return { ok: true, result: { message_id: 42, chat: { id: -123 }, date: 1791777600 } };
    });
    const result = await dispatchTelegramAlert(alert, { telemetryId: db.row.id });
    assert.equal(result.outcome, 'accepted'); assert.equal(result.finalized, true);
    assert.equal(result.messageId, 42); assert.equal(result.chatId, -123);
    assert.equal(result.telegramDate, 1791777600); assert.ok(result.attemptedAt);
    assert.equal(db.row.telegram_status, 'sent'); assert.equal(db.row.telegram_error, null);
    await dispatchTelegramAlert(alert, { telemetryId: db.row.id });
    assert.equal(sends, 1);
  });

  it('suppresses repeated cron and concurrent claims', async () => {
    const db = mockDatabase(); setPoolForTest(db.pool);
    const results = await Promise.all(Array.from({ length: 8 }, () => dispatchTelegramAlert(alert, { telemetryId: db.row.id })));
    assert.equal(results.filter(result => result.outcome === 'accepted').length, 1);
    assert.equal(sends, 1);
  });

  it('does not resend legacy pending or failed rows', async () => {
    const db = mockDatabase({ legacy: true }); setPoolForTest(db.pool);
    assert.equal((await dispatchTelegramAlert(alert, { telemetryId: db.row.id })).outcome, 'suppressed');
    assert.equal(sends, 0); assert.equal(db.row.telegram_error, 'old failure');
  });

  it('respects retry_after, persists backoff, and stops after three safe attempts', async () => {
    const db = mockDatabase(); setPoolForTest(db.pool);
    setTelegramAlertSenderForTest(async () => {
      sends++; return { ok: false, outcome: 'rejected', error_code: 429, parameters: { retry_after: 10 } };
    });
    const before = Date.now();
    await dispatchTelegramAlert(alert, { telemetryId: db.row.id });
    assert.ok(claimOf(db.row.telegram_error).nextAttemptAt >= before + 10000);
    assert.equal((await dispatchTelegramAlert(alert, { telemetryId: db.row.id })).outcome, 'deferred');
    for (let attempt = 1; attempt < 3; attempt++) {
      const claim = claimOf(db.row.telegram_error); claim.nextAttemptAt = 0;
      db.row.telegram_error = 'phase1:' + JSON.stringify(claim);
      await dispatchTelegramAlert(alert, { telemetryId: db.row.id });
    }
    assert.equal(claimOf(db.row.telegram_error).state, 'terminal');
    await retryPendingTelegramAlerts(); assert.equal(sends, 3);
  });

  it('uses exponential backoff for explicit transient API rejections', async () => {
    const db = mockDatabase(); setPoolForTest(db.pool);
    setTelegramAlertSenderForTest(async () => ({ ok: false, outcome: 'rejected', error_code: 503 }));
    let now = Date.now(); await dispatchTelegramAlert(alert, { telemetryId: db.row.id });
    assert.ok(claimOf(db.row.telegram_error).nextAttemptAt >= now + 1000);
    const claim = claimOf(db.row.telegram_error); claim.nextAttemptAt = 0;
    db.row.telegram_error = 'phase1:' + JSON.stringify(claim);
    now = Date.now(); await dispatchTelegramAlert(alert, { telemetryId: db.row.id });
    assert.ok(claimOf(db.row.telegram_error).nextAttemptAt >= now + 2000);
  });

  it('holds timeout and uncertain network outcomes across a simulated restart', async () => {
    for (const response of ['timeout', 'network']) {
      const db = mockDatabase(); setPoolForTest(db.pool);
      setTelegramAlertSenderForTest(async () => { sends++; throw new Error(response); });
      assert.equal((await dispatchTelegramAlert(alert, { telemetryId: db.row.id })).outcome, 'unknown');
      assert.equal(claimOf(db.row.telegram_error).state, 'unknown');
      setTelegramAlertSenderForTest(async () => { throw new Error('must not resend'); });
      setPoolForTest({ ...db.pool } as pg.Pool);
      assert.equal((await dispatchTelegramAlert(alert, { telemetryId: db.row.id })).outcome, 'unknown');
    }
    assert.equal(sends, 2);
  });

  it('keeps permanent Telegram failures terminal', async () => {
    const db = mockDatabase(); setPoolForTest(db.pool);
    setTelegramAlertSenderForTest(async () => { sends++; return { ok: false, outcome: 'rejected', error_code: 403 }; });
    await dispatchTelegramAlert(alert, { telemetryId: db.row.id });
    await dispatchTelegramAlert(alert, { telemetryId: db.row.id });
    assert.equal(claimOf(db.row.telegram_error).state, 'terminal'); assert.equal(sends, 1);
  });

  it('never resends when PostgreSQL finalization fails after acceptance', async () => {
    const db = mockDatabase({ failFinalize: true }); setPoolForTest(db.pool);
    const result = await dispatchTelegramAlert(alert, { telemetryId: db.row.id, deadlineAtMs: Date.now() + 5500 });
    assert.equal(result.outcome, 'accepted'); assert.equal(result.messageId, 42);
    assert.equal(result.finalized, false); assert.equal(result.error, 'delivery_status_update_failed');
    assert.equal(claimOf(db.row.telegram_error).state, 'attempted');
    await dispatchTelegramAlert(alert, { telemetryId: db.row.id }); assert.equal(sends, 1);
  });

  it('never sends if database preparation or claim confirmation fails', async () => {
    const prep = mockDatabase({ failPrepare: true }); setPoolForTest(prep.pool);
    await assert.rejects(dispatchTelegramAlert(alert), /database offline/);
    const db = mockDatabase({ failClaim: true }); setPoolForTest(db.pool);
    await assert.rejects(dispatchTelegramAlert(alert, { telemetryId: db.row.id }), /database offline/);
    assert.equal(sends, 0);
  });

  it('durably defers delivery near the scheduler deadline', async () => {
    const db = mockDatabase(); setPoolForTest(db.pool);
    assert.equal((await dispatchTelegramAlert(alert, { telemetryId: db.row.id, deadlineAtMs: Date.now() + 100 })).outcome, 'deferred');
    assert.equal(claimOf(db.row.telegram_error).state, 'pending'); assert.equal(sends, 0);
  });

  it('shares identities across sources and aliases while distinguishing idling milestones', () => {
    const base = { ...alert, eventType: 'IGNITION_ON' };
    assert.equal(telegramEventIdentity(base), telegramEventIdentity({ ...base, eventType: 'IGNITION ON ALERT', sourceEventKey: 'old-history-key' }));
    assert.notEqual(telegramEventIdentity({ ...alert, idlingThresholdMinutes: 10 }), telegramEventIdentity({ ...alert, idlingThresholdMinutes: 25 }));
  });

  it('validates required event data before sending', async () => {
    await assert.rejects(dispatchTelegramAlert({ ...alert, recordedAt: 'invalid' }), /Invalid Telegram alert/);
    await assert.rejects(dispatchTelegramAlert({ ...alert, telegramMessage: '' }), /Invalid Telegram alert/);
    assert.equal(sends, 0);
  });

  it('fails closed on incompatible database columns without attempting a migration', async () => {
    const queries: string[] = [];
    const pool = { query: async (sql: string) => { queries.push(sql); return { rows: [
      { name: 'telegram_error', type: 'character varying(30)' },
    ] }; } } as unknown as pg.Pool;
    setPoolForTest(pool);
    await assert.rejects(dispatchTelegramAlert(alert), /schema approval required/);
    assert.equal(sends, 0); assert.ok(queries.every(sql => sql.trim().startsWith('SELECT')));
  });
});

describe('existing Telegram HTTP sender', () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.BOT_TOKEN;
  const originalChat = process.env.CHAT_ID;
  beforeEach(() => { process.env.BOT_TOKEN = 'mock-token'; process.env.CHAT_ID = '-123'; });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.BOT_TOKEN; else process.env.BOT_TOKEN = originalToken;
    if (originalChat === undefined) delete process.env.CHAT_ID; else process.env.CHAT_ID = originalChat;
  });
  it('preserves formatted text and exposes Telegram acceptance receipt', async () => {
    globalThis.fetch = async (_url, init) => {
      assert.equal(new URLSearchParams(init?.body as URLSearchParams).get('text'), alert.telegramMessage);
      return Response.json({ ok: true, result: { message_id: 1, chat: { id: -123 }, date: 100 } });
    };
    const result = await sendTelegram(alert.telegramMessage!);
    assert.equal(result.httpStatus, 200); assert.equal(result.result?.message_id, 1);
  });
  it('exposes explicit 429 rejection and retry_after', async () => {
    globalThis.fetch = async () => Response.json({ ok: false, error_code: 429, parameters: { retry_after: 17 } }, { status: 429 });
    const result = await sendTelegram(alert.telegramMessage!);
    assert.equal(result.outcome, 'rejected'); assert.equal(result.parameters?.retry_after, 17);
  });
  it('holds malformed and proxy responses as unknown', async () => {
    globalThis.fetch = async () => new Response('proxy error', { status: 502 });
    assert.equal((await sendTelegram(alert.telegramMessage!)).outcome, 'unknown');
    globalThis.fetch = async () => Response.json({ ok: true });
    assert.equal((await sendTelegram(alert.telegramMessage!)).outcome, 'unknown');
  });
  it('classifies timeout and connection errors without exposing token-bearing URLs', async () => {
    globalThis.fetch = async () => { throw new DOMException('https://api.telegram.org/botmock-token/sendMessage', 'AbortError'); };
    const timedOut = await sendTelegram(alert.telegramMessage!);
    assert.equal(timedOut.outcome, 'unknown'); assert.match(timedOut.error!, /telegram_timeout/);
    globalThis.fetch = async () => { throw new Error('https://api.telegram.org/botmock-token/sendMessage'); };
    const failure = await sendTelegram(alert.telegramMessage!);
    assert.equal(failure.outcome, 'unknown'); assert.equal(JSON.stringify(failure).includes('mock-token'), false);
  });
});
