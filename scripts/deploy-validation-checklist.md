# Deployment Validation Checklist

## Telemetry Alert Persistence Fix + Vercel Cron Scheduler

### Pre-Deployment

- [ ] **Migration 041 applied**: `pnpm --filter car-tracker-backend exec tsx src/db/migrate.ts`
  - Creates `scheduler_runs` table with columns: id, started_at, finished_at, status, cycles_completed, error_message, created_at
  - Creates `gps_idling_dedup` table (migration 040) with `UNIQUE(vehicle_id, active_trip_id, threshold_minutes)`
- [ ] **TypeScript compiles**: `pnpm --filter car-tracker-backend build && pnpm --filter car-tracker-frontend build`
- [ ] **No lint errors**: Check for any remaining TS errors

### Architecture Confirmation — Route Flow

The route `/api/cron/sync-tracker` is reachable on Vercel through this chain:

```
Vercel Cron              → GET /api/cron/sync-tracker
vercel.json rewrite      → /api/index.ts
api/index.ts             → imports backend/dist/app.js (compiled Express)
app.ts mount             → app.use('/api/cron', cronRouter)
cronRouter               → GET /sync-tracker → handler
```

This works because the **backend is deployed in the same Vercel project** as the frontend.
The single serverless function at `/api/index.ts` handles ALL `/api/*` traffic.

### Environment Variables (Vercel)

- [ ] `DATABASE_URL` — PostgreSQL connection string
- [ ] `BOT_TOKEN` — Telegram bot token
- [ ] `CHAT_ID` — Telegram chat ID for alerts
- [ ] `CARTRACK_USERNAME` — Cartrack API username
- [ ] `CARTRACK_PASSWORD` — Cartrack API password
- [ ] `CARTRACK_API_URL` — Cartrack API base URL
- [ ] `CRON_SECRET` — Secret key for cron authorization (used by Vercel Cron)

### Deployment Steps

1. **Apply database migration**:
   ```bash
   pnpm --filter car-tracker-backend exec tsx src/db/migrate.ts
   ```

2. **Deploy to Vercel**:
   ```bash
   # Push to Git → Vercel auto-deploys, or use `vercel --prod`
   ```

3. **Verify cron route works in production**:
   ```bash
   curl "https://your-vercel-domain.vercel.app/api/cron/sync-tracker?secret=YOUR_CRON_SECRET"
   ```
   Expected response (200 OK):
   ```json
   {
     "success": true,
     "elapsed_seconds": 1.23,
     "cron_mode": "Vercel Cron",
     "run_id": 1,
     "timestamp": "2026-07-01T12:00:00.000Z"
   }
   ```

4. **Verify cron route is authorized** (no secret = 401):
   ```bash
   curl "https://your-vercel-domain.vercel.app/api/cron/sync-tracker"
   ```
   Expected response (401):
   ```json
   {
     "success": false,
     "error": "Unauthorized — missing or invalid cron secret"
   }
   ```

### Post-Deployment Verification

- [ ] **Vercel Cron triggers daily**: Vercel sends `GET /api/cron/sync-tracker` daily at midnight UTC
- [ ] **Cron function logs show success**: Check Vercel dashboard → Function logs for `[cron]` entries
- [ ] **`scheduler_runs` table has records**:
  ```sql
  SELECT * FROM scheduler_runs ORDER BY started_at DESC LIMIT 5;
  ```
- [ ] **Dashboard shows cron status**: Open Settings → Connection page → expand "Internal Scheduler" card
  - Should show "Cron mode: Vercel Cron"
  - Should show last run time, last status, cycles completed
  - Should have "Run Once" button that triggers the scheduler
  - Should have "Run History" section with run records
- [ ] **Dashboard no longer shows "Disconnected"** for the scheduler — it reads from DB
- [ ] **No `setInterval` on Vercel**: In-memory interval is only used locally; Vercel relies on Cron Jobs
- [ ] **No re-classification warnings**: The old `hasMeaningfulLocationChange` and `IDLE_THRESHOLD_MS` logic is removed
- [ ] **Telemetry records use new event types**: Query `gps_telemetry` for `event_type` values:
  ```sql
  SELECT DISTINCT event_type FROM gps_telemetry ORDER BY event_type;
  ```
  Expected: `IGNITION ON ALERT`, `IDLING ALERT`, `MOVING ALERT`, `LOCATION UPDATE ALERT`, `SPEEDING ALERT`, `LOW FUEL ALERT`, `IGNITION OFF ALERT`

- [ ] **No old event types**: The old `IGNITION ON`, `IGNITION OFF`, `IDLING` values should no longer appear
- [ ] **Idling dedup working**: Check `gps_idling_dedup` table has entries:
  ```sql
  SELECT vehicle_id, active_trip_id, threshold_minutes FROM gps_idling_dedup;
  ```
- [ ] **`active_trip_id` consistency**: Verify a single trip has one `active_trip_id`:
  ```sql
  SELECT active_trip_id, COUNT(*) as records
  FROM gps_telemetry
  WHERE vehicle_id = '<vehicle-id>'
  GROUP BY active_trip_id;
  ```

### Dashboard UI Checks

- [ ] **Connection page loads**: `/settings/connections` renders all connection cards
- [ ] **Scheduler card expands**: Click to see metrics, "Run Once" button, "Run History"
- [ ] **Run Once works**: Click → shows spinner → success toast → run records appear in history
- [ ] **Run History loads**: Expand the section → see summary stats and recent runs table
- [ ] **Status reflects DB data**: The green/amber/grey badge correctly shows connected/degraded/disconnected based on recent cron runs

### Vercel Cron-Specific Notes

- **Hobby plan**: Cron jobs run once daily at the configured time (`0 0 * * *` = midnight UTC)
- **Pro plan**: More frequent schedules are supported (e.g., every hour, every 15 minutes)
- **External alternative**: Use cron-job.org or similar to call `/api/cron/sync-tracker?secret=...` at any interval
- **Timeout**: The serverless function has `maxDuration: 60` in `vercel.json` (configured in functions block)
- **Cold starts**: First invocation after idle may take 1-2 seconds longer due to cold start

### Rollback Plan

If issues are detected:

1. **Revert code changes** to `vercel.json`, `cron.ts`, `settings.ts`, `scheduler.ts`, `schedulerRunService.ts`, ConnectionPage.tsx, settings-api.ts
2. **Migration 041 is additive only** (CREATE TABLE IF NOT EXISTS) — no rollback needed
3. **Vercel cron can be disabled** by removing the `"crons"` block from `vercel.json`
4. **Old scheduler status** will still work locally via `getSchedulerState()` in-memory

### Monitoring (First 24 Hours)

- [ ] **Telegram alerts still sending**: Verify alerts appear in Telegram
- [ ] **No IGNITION OFF during idling**: Check for vehicles that were idling but got `IGNITION OFF ALERT`
- [ ] **Idling milestones correct**: Verify 10min, 15min, 30min alerts are firing
- [ ] **Speed limit 80**: Verify speeding alerts fire at 80+ km/h
- [ ] **Low fuel 5L**: Verify low fuel alerts fire below 5L

### Regression Test Suite

Run the regression tests against a test database:

```bash
DATABASE_URL=postgresql://... node scripts/regression-test-telemetry.js
```

Expected output: 8/8 tests passed, 0 failed.

### Files Changed

| File | Change Type |
|------|-------------|
| `packages/tracker/tracker.js` | Modified (existing) |
| `packages/tracker/types.d.ts` | Modified (existing) |
| `backend/src/services/scheduler.ts` | Modified (exported runCycle) |
| `backend/src/services/gpsTelemetryService.ts` | Modified (existing) |
| `backend/src/db/migrations/040_create_gps_idling_dedup.sql` | Existing |
| `backend/src/db/migrations/041_create_scheduler_runs.sql` | **New** |
| `backend/src/services/schedulerRunService.ts` | **New** |
| `backend/src/routes/cron.ts` | Rewritten with DB persistence |
| `backend/src/routes/settings.ts` | Modified (async checkSchedulerStatus, new endpoints) |
| `frontend/src/modules/settings/api/settings-api.ts` | Modified (new API functions) |
| `frontend/src/modules/settings/pages/ConnectionPage.tsx` | Modified (Run Once + Run History) |
| `vercel.json` | Modified (crons section added) |
| `scripts/deploy-validation-checklist.md` | Updated with Vercel Cron section |