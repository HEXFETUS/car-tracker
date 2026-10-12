# Phase 1 alert delivery audit and operations

## Before implementation

- `scheduler.saveTelemetryAndSendTelegram` inserts a complete pending GPS row,
  then calls `sendTelegramForTelemetry`. It sends even when insertion returns an
  existing duplicate row, without checking its delivery status.
- `scheduler.handleIdlingAlertInTransaction` commits the idling milestone and
  telemetry row, then independently sends and records delivery. Its row lock
  does not serialize the first milestone when no dedup row exists yet.
- `historyAlertSyncService.syncHistoryBackedAlerts` inserts each derived event,
  sends new rows, and advances its cursor. `retryHistoryTelegram` resends every
  historical row not marked sent, including ambiguous and permanently failed
  deliveries. A successful send followed by a failed database update can be
  incorrectly recorded as failed.
- `packages/tracker.sendVehicleAlerts` uses message-based shared detection
  state, calls a no-op telemetry insertion helper, then sends directly.
  `run-sync.js` invokes this route. The backend calls `syncFleetAndAlert` with
  `dispatchAlerts: false` and performs its own GPS processing.
- All actual HTTP requests use `packages/tracker.sendTelegram`. It returns raw
  Telegram JSON, discards HTTP status, and collapses uncertain network outcomes
  into ordinary failures. Its declaration omits message receipt metadata.
- Backend cron has a scheduler lock and per-process cycle guard, but these do
  not cover every delivery entry point. Historical recovery is intentionally
  disabled in the Hobby-plan live scheduler and must remain disabled.

## Baseline

On 2026-10-12, backend tests passed (107/107) and `pnpm build` passed.
`pnpm lint` failed before implementation: ESLint 10 cannot find a root flat
configuration. The configured PostgreSQL hostname failed DNS resolution, so
production schema compatibility could not be verified from this workspace.
No production database writes or real Telegram sends are used for validation.

## Implemented flow

Cartrack -> existing fleet rules -> durable pending GPS row -> atomic attempted
claim -> Telegram response -> delivery finalization in PostgreSQL.

Pending rows retain the original event, GPS fields, historical timestamp, and
formatted message. They are not marked delivered. A short per-vehicle
transaction advisory lock serializes duplicate lookup and insertion, including
the first idling milestone. No transaction or advisory lock is held across the
Telegram HTTP request. An atomic compare-and-set on `telegram_error` elects the
single sending worker. A database or commit failure before a confirmed claim
prevents sending.

Event keys use the vehicle, canonical event type, timestamp, and idling
threshold. Idling uses the known idle-session start when supplied, so a
milestone observed later by history matches the live event. Existing semantic
deduplication remains in place: ignition time windows, normalized location and
minute matching, trip milestone rules, and low-fuel claims. Ignition matching
now bounds both ends of the window to avoid treating a much later live event
as a duplicate of an older history event. Idling thresholds remain distinct
even within one minute. Existing historical keys are preserved, not rewritten.
Identities cannot reconcile genuinely different source timestamps/session
estimates beyond the existing semantic rules.

Successful responses return the event/row identity, attempt time, message ID,
chat ID, and Telegram Unix timestamp. Receipt fields are returned and logged;
no receipt columns are added. Acceptance is not proof that a person read the
message. The original live and historical message formats are preserved.

The live scheduler performs a bounded pending-delivery recovery pass without
fetching historical Cartrack data. The Hobby-plan historical synchronization
pass remains disabled. Explicit historical synchronization uses the same
dispatcher and only advances a point's cursor once its events have durable
records. Telegram failure does not prevent that advance; database preparation
failure does. No-TO processing, travel-order linking, notifications, ignition
confirmation, and operational vehicle state remain in place. An existing
deduplicated ignition row now also permits operational state confirmation.

## Delivery states and recovery

The existing `telegram_status` values are unchanged. Claim metadata lives in
`telegram_error` as `phase1:` followed by a versioned JSON envelope:

| Envelope state | Meaning | Automatic sending |
| --- | --- | --- |
| `pending` | Newly recorded; no send claimed | Eligible |
| `attempted` | Claim committed; request may have been accepted | Never reclaimed |
| `retry` | Explicit safe Telegram rejection with next eligible time | Eligible when due, below three attempts |
| `unknown` | Timeout, ambiguous network/response outcome | Held for review |
| `terminal` | Permanent rejection or retry budget exhausted | Held for review |
| No recognized envelope | Legacy or unrecognized delivery state | Held for review |

After acceptance, `telegram_status` becomes `sent` and `telegram_error` is
cleared. Failed/unknown outcomes use `failed` with the envelope retained.
Legacy quarantine is an eligibility rule; it does not bulk update old rows.

Only explicit Bot API 429 or server-error rejections are automatically retried,
at most three sends total, with minimum delays of one and two seconds.
`retry_after` can extend those delays. Retries are persisted and performed by
later scheduler/recovery passes; serverless requests do not wait for future
send retries. Missing configuration and permanent errors do not loop. Each
recovery pass selects at most 25 due pending/retry rows across both sources.
Future retries cannot occupy the entire selection ahead of eligible work.
The dispatcher defers sending when its configured request timeout will not fit
the supplied execution deadline.

If Telegram accepts but finalization fails, the dispatcher retries only the
database update (at most three attempts, with bounded exponential delays and
deadline checks). It still reports acceptance and logs the receipt. If all
updates fail, the committed attempted claim remains and blocks automatic
resending. An operator can reconcile that row using the acceptance log.

Telegram has no general sendMessage idempotency key. A crash between claim and
send can leave an unsent alert held; a crash or timeout after acceptance can
leave an accepted message unfinalized. We cannot safely distinguish these
cases after restart. This design favors suppressing duplicates over automatic
recovery of uncertain outcomes; it does not guarantee exactly-once delivery.

## Database and configuration impact

No migration, new schema, deletion, retention job, frontend edit, dependency,
authentication change, or production environment edit was introduced. Existing
GPS rows and all existing travel-order/trip storage remain intact. The existing
runtime history/idling schema guards are retained; Phase 1 adds no new DDL.

Delivery now requires a pending row, transaction-scoped duplicate lock, atomic
attempt claim, and post-response finalization. Read-only schema checks run once
per backend pool before alert processing. They require existing compatible
delivery/source columns, including unrestricted text for `telegram_error`, and
hold dispatch if an error-column check constraint needs review. An incompatible
schema is reported for approval instead of altered by the dispatcher.

Production compatibility remains unverified here because its hostname did not
resolve. The disposable PostgreSQL 18 fixture validated text delivery columns,
the existing sent/failed/skipped status constraint, source-event uniqueness,
transaction locks, atomic claims, and trigger-induced database failures.

The CLI now uses the existing backend configuration and validation, runs
`runCycle` without starting Express or an interval scheduler, and closes both
existing pools. Build the backend before `pnpm tracker:sync`. The exported
`sendVehicleAlerts` also loads the compiled backend bridge; standalone callers
must provide a valid event identity/timestamp rather than an unidentifiable
message string. `sendTelegram` remains the one low-level Bot API implementation.

## Modified and created files

| File | Purpose |
| --- | --- |
| `backend/src/services/telegramAlertDispatcher.ts` | Shared dispatcher, compatibility check, event identity, durable claims, recovery, and diagnostics |
| `backend/src/services/gpsTelemetryService.ts` | Allow transaction injection, share normalization, bound ignition deduplication, distinguish idling thresholds, return suppressed row IDs for dispatch |
| `backend/src/services/scheduler.ts` | Route live/idling alerts through shared dispatch, recover pending deliveries, preserve GPS confirmation on existing rows |
| `backend/src/services/historyAlertSyncService.ts` | Share delivery/recovery while preserving derivation, timestamps, cursor progress, and notifications |
| `backend/src/services/trackerAlertBridge.ts` | Adapt exported tracker alert events to backend dispatch |
| `backend/src/cli/trackerSync.ts` | Run the backend synchronization service and close both pools |
| `packages/tracker/tracker.js` | Normalize Telegram responses, redact uncertain transport errors, bridge exported alert delivery, expose pool shutdown and idle-session timestamps |
| `packages/tracker/types.d.ts` | Describe Telegram receipts, tracker alert inputs, helper summaries, and shutdown |
| `packages/tracker/run-sync.js` | Invoke compiled backend CLI entry point |
| `backend/src/services/gpsTelemetryRules.test.ts` | Update the existing idling transaction mock for shared claims |
| `backend/src/services/telegramAlertDispatcher.test.ts` | Mocked delivery, retry, failure, deadline, compatibility, and HTTP-sender tests |
| `backend/src/services/telegramAlertDispatcher.postgres.test.ts` | Disposable PostgreSQL concurrency, restart, overlap, cursor, bridge, and trigger-failure tests |
| `backend/src/cli/trackerSync.test.ts` | CLI summary, failure exit, and pool cleanup tests |
| `docs/phase-1-alert-delivery.md` | Pre-change audit, behavior, validation, deployment, and rollback notes |

## Validation

Final checks on 2026-10-12:

- `pnpm --filter car-tracker-backend test`: **143/143 passed**, 32 suites, no
  skips, including 16 actual PostgreSQL cases and the compiled tracker bridge.
- `pnpm build`: **passed** (backend TypeScript and frontend Vite).
- `pnpm lint`: **failed with the same pre-existing missing root ESLint config**;
  no lint configuration was changed as part of Phase 1.
- Targeted ESLint for all new TypeScript files: **passed with no warnings**,
  using the existing backend config with its two type-aware rules disabled
  because that config does not configure parser type information. This does
  not replace the failing root lint check.
- JavaScript syntax checks for the modified tracker and CLI runner and
  `git diff --check`: **passed**.

External Telegram and Cartrack requests are mocked. PostgreSQL tests use only an explicitly
supplied localhost `PHASE1_TEST_DATABASE_URL`, never `DATABASE_URL`, and create
and remove their own uniquely named disposable schema. They skip when no test
cluster is supplied. The compiled tracker-bridge case additionally requires a
backend build.

To repeat the PostgreSQL suite, build the backend, supply a disposable localhost
PostgreSQL connection in `PHASE1_TEST_DATABASE_URL`, then run:

```text
pnpm --filter car-tracker-backend test
pnpm lint
pnpm build
```

## Deployment instructions (not executed)

1. Build and validate the candidate with external services mocked. Resolve the
   existing lint configuration issue separately. Stage the deployment before
   scheduling the cutover; no database migration is needed.
2. On the target environment, verify schema compatibility read-only using the
   built backend before switching workers. From `backend`, with its existing
   environment loaded, run:

   ```sh
   node --input-type=module -e "import 'dotenv/config'; const {ensureTelegramAlertCompatibility}=await import('./dist/services/telegramAlertDispatcher.js'); const {closePool}=await import('./dist/db/db.js'); try { await ensureTelegramAlertCompatibility(); console.log('Phase 1 delivery schema compatible'); } finally { await closePool(); }"
   ```

3. Briefly pause cron triggers and stop old local/CLI schedulers. Let in-flight
   sends finish. Do not overlap old workers, which do not honor Phase 1 claims,
   with new workers. Keep the protected cron endpoint and existing internal
   scheduler setting as configured.
4. Switch the backend artifact, including the compiled bridge and CLI module.
   Vercel already builds the backend before the frontend; keep that build order.
   Keep historical recovery disabled under the existing Hobby configuration.
5. Resume the configured scheduler and inspect a normal cycle: operational GPS
   state/trip progress, detected events, claim suppression, Telegram acceptance,
   and database finalization. Monitor unknown outcomes and finalization failures
   by event/telemetry ID. Do not repeatedly trigger an alert as a smoke test.

## Rollback instructions (not executed)

1. Pause all delivery workers and let current requests finish. Preserve all GPS
   records, pending claims, and historical cursors.
2. Inventory unsettled rows read-only, including `telegram_status`,
   `telegram_error`, `telegram_attempted_at`, and `source_event_key`. Reconcile
   confirmed acceptance from logged event IDs/message receipts. Do not equate a
   missing database `sent` status with a missed Telegram message.
3. Keep uncertain attempted/unknown and legacy rows held for operator review.
   Do not clear their metadata or automatically replay them. The old sender and
   historical retrier do not understand these holds: keep legacy history/CLI
   sending disabled until review, and recognize that restoring the old live
   implementation also restores its pre-existing duplicate risks.
4. Restore the prior backend and tracker artifacts together and rebuild them.
   No schema rollback or record deletion is required. Resume the selected live
   scheduler only after reviewing unsettled delivery risks and verify GPS/trip
   progress. A code rollback cannot undo Telegram messages already accepted.

Phase 2 and later work, production deployment, and data reconciliation are not
performed by this change.
