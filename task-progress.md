# Car Tracker - GPS Telemetry Fix Implementation

## Root Causes Identified

1. **Three independent ignition detection paths** - Scheduler.ts has TWO paths (DB-backed + emittedAlerts) and tracker.js has its own detection. All can fire in the same cycle.
2. **active_trip_id-based dedup is broken** - Each path generates different tripId formats (`trip-${vid}-${now}` vs `randomUUID()`), so dedup by `vehicle_id + active_trip_id + event_type` NEVER catches duplicates.
3. **No ignition debounce** - Any OFF→ON→OFF glitch is saved as real events.
4. **No coordination between scheduler paths** - DB-backed detection (line 1525) and emittedAlerts processing (line 1759) both check the same vehicle with no cross-check.
5. **Telegram sent even when telemetry insert is skipped** - Not all paths check `savedTelemetry.inserted` before sending Telegram.

## Implementation Plan

- [x] Phase 1: Trace complete flow (done)
- [x] Phase 2-3: Investigate root causes (done)
- [ ] Phase 4: Create VehicleStateMachine (gpsVehicleStateService.ts)
- [ ] Phase 5: Create ignition debounce mechanism
- [ ] Phase 6: Fix telemetry deduplication to use time-window (not tripId)
- [ ] Phase 7: Fix trip creation - reuse existing active trip
- [ ] Phase 8: Fix Telegram notifications - only send after confirmed insert
- [ ] Phase 9: Fix scheduler.ts to use state machine, eliminate dual paths
- [ ] Phase 10: Add comprehensive logging
- [ ] Phase 11: Configuration (move thresholds to env)
- [ ] Phase 12: Create tests
- [ ] Phase 13: Verify all tests pass
- [ ] Phase 14: Migration scripts if needed