# Testing Plan for Hardening Verification

## 1. Scheduler Soak Test (Highest Priority)

### Objective
Verify the scheduler runs continuously for 24+ hours without:
- Duplicate telemetry inserts
- Skipped IDLING_TOO_LONG alerts
- Duplicate Telegram messages
- Missed IGNITION_OFF events
- Stuck `gps_idling_dedup` rows
- Active trips left open incorrectly

### Setup
1. Deploy to staging with latest code
2. Ensure scheduler is running (`GET /api/settings/scheduler-state`)
3. Set sync interval to 60s for faster observation (`POST /api/settings/scheduler-interval`)

### Test Procedure

#### Phase A: Baseline (Hours 0-4)
- Monitor scheduler logs for normal operation
- Verify `cycleLock` prevents overlaps when cron fires during long cycles
- Confirm `[scheduler] Previous cycle still running — skipping this execution` appears when appropriate

#### Phase B: Stress (Hours 4-24)
- Trigger manual cron execution while scheduler is running (`POST /api/cron/sync-tracker`)
- Verify no duplicate telemetry in `gps_telemetry` for same `(vehicle_id, recorded_at, event_type)`
- Check Telegram channel for duplicate alerts (compare message timestamps)
- Query `gps_idling_dedup` for stuck `is_active = true` rows with old `last_alerted_at`

#### Verification Queries

```sql
-- Duplicate telemetry check (should return 0 rows)
SELECT vehicle_id, recorded_at, event_type, COUNT(*)
FROM gps_telemetry
GROUP BY vehicle_id, recorded_at, event_type
HAVING COUNT(*) > 1;

-- Stuck idling sessions (should return 0 or very few rows)
SELECT vehicle_id, active_trip_id, last_alerted_at
FROM gps_idling_dedup
WHERE is_active = true
  AND last_alerted_at < NOW() - INTERVAL '2 hours';

-- Orphan active trips (should return 0 rows)
SELECT DISTINCT active_trip_id
FROM gps_telemetry
WHERE active_trip_id IS NOT NULL
  AND event_type NOT IN ('IGNITION_ON', 'IGNITION_OFF', 'LOCATION_UPDATE', 'IDLING_TOO_LONG', 'MOTION_STARTED')
GROUP BY active_trip_id
HAVING COUNT(*) = 0;
```

### Acceptance Criteria
- Zero duplicate telemetry rows
- Zero duplicate Telegram alerts for same event
- All IGNITION_OFF events have matching IGNITION_ON
- No `gps_idling_dedup` rows stuck active for >2 hours without recent alerts
- Scheduler cycle duration remains stable (no memory leaks)

---

## 2. Multi-Destination End-to-End Test

### Objective
Verify a vehicle completes a multi-stop travel order correctly.

### Test Route
```
Origin: Trade Street, Zone 1, Pueblo de Oro
  ↓ Stop 1: SM City CDO (8.4794, 124.6639)
  ↓ Stop 2: Limketkai Center (8.4923, 124.6472)
  ↓ Final: Airport (8.6156, 124.6375)
```

### Steps

#### Step 1: Create Travel Order
```json
POST /api/travel-orders
{
  "toNumber": "TO-2026-0001",
  "originLocation": "Trade Street, Zone 1, Pueblo de Oro, Balulang, Cagayan de Oro, Northern Mindanao, 9000, Philippines",
  "destinations": [
    {
      "locationName": "SM City CDO",
      "latLong": "8.4794,124.6639",
      "stopOrder": 1
    },
    {
      "locationName": "Limketkai Center",
      "latLong": "8.4923,124.6472",
      "stopOrder": 2
    },
    {
      "locationName": "Lumbia Airport",
      "latLong": "8.6156,124.6375",
      "stopOrder": 3
    }
  ],
  "scheduledDepartureAt": "2026-07-05T08:00:00+08:00",
  "purpose": "Multi-destination test"
}
```

#### Step 2: Drive the Route
- Assign vehicle KAR6444 to the travel order
- Drive from Origin → SM City → Limketkai → Airport
- Ensure ignition stays ON throughout

#### Step 3: Verify Destination Progression
```sql
SELECT id, stop_order, location_name, status, arrived_at
FROM travel_order_destinations
WHERE travel_order_id = '<created_id>'
ORDER BY stop_order;
```

**Expected:**
```
Stop 1: ARRIVED (timestamp when vehicle arrived at SM)
Stop 2: IN_PROGRESS → ARRIVED (after arriving at Limketkai)
Stop 3: IN_PROGRESS → ARRIVED (after arriving at Airport)
Travel Order: COMPLETED
```

#### Step 4: Verify Dashboard Consistency
- Dashboard live view shows vehicle at each stop
- Telemetry `LOCATION_UPDATE` events match actual locations
- GPS trip log linked to travel order via `travel_order_id`

### Acceptance Criteria
- All 3 destinations marked ARRIVED in sequence
- Travel order status = COMPLETED
- No skipped destinations
- Dashboard, telemetry, and trip logs all show consistent progression

---

## 3. Authentication Regression Test

### Objective
Verify role-based access control works correctly after adding `requireRole` middleware.

### Test Matrix

| Role | Expected Access | Expected Deny |
|------|----------------|---------------|
| SUPERADMIN | All routes | None |
| ADMIN | Travel orders, vehicles, drivers, dashboard, reports, gps-logs, settings | None |
| DISPATCHER | Travel orders, vehicles, drivers, dashboard, gps-logs | Settings, users |
| HR | Travel orders, dashboard | Settings, users, gps-logs |
| VIEWER | Dashboard, travel orders, reports | Settings, users, gps-logs, maintenance |
| Public (no header) | `/api/auth/login`, `/api/public/travel-orders`, `/api/health`, `/api/cron` | All others |

### Test Procedure

#### For Each Role:
1. Set `x-user-type` header to role name
2. Test access to each endpoint category
3. Verify 200 for allowed, 403 for denied

#### Quick Smoke Test
```bash
# Should succeed
curl -H "x-user-type: VIEWER" http://localhost:3000/api/dashboard/summary

# Should fail with 403
curl -H "x-user-type: VIEWER" http://localhost:3000/api/settings/connection-status

# Should fail with 401 (no header)
curl http://localhost:3000/api/travel-orders
```

### Acceptance Criteria
- Each role can only access allowed endpoints
- No role can access `/api/settings` except SUPERADMIN
- Unauthenticated requests get 401 on protected routes

---

## 4. Migration Verification

### Objective
Confirm a fresh database applies all migrations in sequence without errors.

### Procedure

#### Step 1: Create Fresh Database
```bash
createdb car_tracker_test
```

#### Step 2: Apply Migrations
```bash
cd backend
pnpm run migrate
```

#### Step 3: Verify Indexes
```sql
-- Run scripts/verify-migrations.sql
\i scripts/verify-migrations.sql
```

#### Expected Results
- `idx_039_exists` = 1
- `has_record_nos` > 0 (existing data) or 0 (fresh DB)
- 4 rows from `056` index query
- `indexes_created` >= 4

### Acceptance Criteria
- All migrations apply without error
- All expected indexes exist
- No duplicate index names

---

## What to Postpone

Per your guidance, these are deferred:

- **ESLint setup** – Valuable but not blocking stability
- **Structured logger** – `console.*` cleanup can happen after telemetry is proven stable
- **Scheduler parallelization** – Bounded concurrency utility is ready but not applied; need soak test first

## Timeline Recommendation

1. **Week 1**: Run scheduler soak test (24-48 hours)
2. **Week 1**: Execute multi-destination e2e test
3. **Week 2**: Authentication regression test with real users
4. **Week 2**: Fresh DB migration verification
5. **After validation**: Consider parallelization and logging improvements

Once all four verification items pass, the system can be considered "stable" for production use.