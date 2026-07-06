# Redesign Travel Order Synchronization - Implementation Plan

## Current Problem
- `gps_trip_logs` created first with `NO_APPROVED_TO`
- Telemetry backfilled AFTER with `to_number` (duplication)
- Order: trip_logs → backfill telemetry

## New Flow Required
- Telemetry created/updated first with `travel_order_id`
- `gps_trip_logs` inherits `travel_order_id` from telemetry
- NO `to_number` duplication anywhere
- `NO_APPROVED_TO` should not be pre-set

## Files to Modify

### 1. `backend/src/services/travelOrderSyncService.ts`
- **`syncTravelOrderToActiveTrip()`** (line 143): Reverse order - update telemetry FIRST, then trip logs inherit
- **`linkTripToTravelOrder()`** (line 380): Remove `to_number` backfill, update all telemetry rows first, then update trip logs to inherit
- **`TravelOrderSyncResult`** interface: Remove `toNumber` field (line 48)

### 2. `backend/src/services/gpsLogService.ts`
- **`syncGpsTripLogsFromTelemetry()`** (line 1353): Remove NO_APPROVED_TO pre-setting, leave trip logs unlinked

### 3. `backend/src/services/gpsTelemetryService.ts`
- **`insertTelemetry()`** (line 239): Remove inheritance from gps_trip_logs (lines 254-276)

### 4. `backend/src/services/scheduler.ts`
- **`runCycle()`** (line 1642): Ensure matching order - can keep as-is since it runs `syncApprovedTravelOrdersToActiveTrips()` after trip log creation

### 5. `backend/src/services/travelOrderSyncService.ts` (additional)
- **`scoreTravelOrderTripCandidate()`** (line 86): Remove line 93 check that rejects already-linked trips
- **`evaluateTravelOrderForTrip()`** (line 255): Remove line 93 equivalent check

## New Flow After Refactoring

```
Tracker
  ↓
gps_telemetry (linked to TO via travel_order_id)
  ↓
Travel Order Matching
  ↓
Update ALL gps_telemetry rows for active_trip_id
  ↓
Create/Update gps_trip_logs (inherit from telemetry)
  ↓
to_status_auto = MATCHED
```

## Key Changes

1. Telemetry becomes source of truth
2. No to_number duplication
3. NO_APPROVED_TO not pre-set
4. All telemetry rows for active_trip_id backfilled
5. Existing trip logs with NULL TO get updated