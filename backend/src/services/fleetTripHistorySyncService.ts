// ── Fleet Trip History Sync Service ────────────────────────────
//
// Synchronizes Fleet GPS trip history from the Cartrack provider into
// the fleet_trip_history table with intelligent trip-based filtering:
//
//   Flow:
//     1. Fetch trip summaries from /rest/trips/{plate} (discovery only)
//     2. For each summary, extract trip_id
//     3. Call Cartrack trip detail/history endpoint for that trip_id
//     4. If details available:
//        - Parse ignition events, moving, idle, stationary, location changes
//        - Apply save rules:
//          - Always save Ignition ON and Ignition OFF
//          - Moving: Save only when resolved location name changes
//          - Idling: Save at milestones (10, 25, 55, 85+ minutes)
//          - Stationary: Save at milestones (same as idle)
//     5. If no detail endpoint exists:
//        - Report that only trip summaries are available
//        - Save only ignition boundary records (Ignition ON/OFF)
//     6. Prevents duplicates via UPSERT on (vehicle_id, time, status, location)
//     7. Links to Travel Orders
//     8. Handles trip overlap: prefers detailed trips over summaries
//   - Latitude/longitude are optional for validation

import { getPool } from '../db/db.js';
import {
  resolveCartrackUnitId,
  fetchCartrackVehicleHistory,
  fetchDetailedPointsForTrip,
  looksLikeTripSummary,
  looksLikeFleetTripHistoryRow,
  type CartrackHistoryPoint,
} from './cartrackHistoryService.js';
import {
  findAllTravelOrdersForDate,
  matchTravelOrderToGpsTrip,
  parseTimestampSafe,
  type TravelOrderWithTimes,
} from './gpsLogService.js';

// ── Constants ──────────────────────────────────────────────────

/** Idle/Stationary milestone intervals in minutes: 10, +15, +30, +30, ... */
const IDLE_MILESTONE_INTERVALS_MINUTES = [10, 15, 30];
const REPEATING_MILESTONE_INTERVAL_MINUTES = 30;

// ── Types ──────────────────────────────────────────────────────

export interface FleetTripHistoryRow {
  id?: string;
  travel_order_id: string | null;
  vehicle_id: string | null;
  driver_id: string | null;
  fleet_trip_id: string | null;
  event_time: string;
  trip_date: string | null;
  status: string;
  event: string | null;
  road_speed: number | null;
  location: string | null;
  latitude: number | null;
  longitude: number | null;
  fuel: number | null;
  created_at?: string;
  updated_at?: string;
  plate_number?: string;
  driver_full_name?: string;
  travel_order_to_number?: string | null;
}

export interface SyncStatistics {
  fetched: number;
  tripSummariesFetched: number;
  detailedTripsRetrieved: number;
  rawActivitiesRetrieved: number;
  saved: number;
  stationarySkipped: number;
  duplicateSkipped: number;
  movingSkippedNoLocationChange: number;
  idleSkippedNotMilestone: number;
  invalidData: number;
  errors: number;
}

export interface SyncResult {
  success: boolean;
  statistics: SyncStatistics;
  message: string;
}

// ── Normalized Fleet Record ────────────────────────────────────

interface NormalizedRecord {
  eventTimeMs: number;
  eventTime: string;
  tripDate: string | null;
  status: string;
  event: string | null;
  roadSpeed: number | null;
  location: string | null;
  latitude: number | null;
  longitude: number | null;
  fuel: number | null;
  fleetTripId: string | null;
  // Raw fields for telemetry preservation
  rawPoint: CartrackHistoryPoint;
}

// ── Trip Activity ──────────────────────────────────────────────

interface TripActivity extends NormalizedRecord {
  isIgnitionOn: boolean;
  isIgnitionOff: boolean;
}

// ── Trip Info ──────────────────────────────────────────────────

interface TripInfo {
  vehicleId: string;
  plateNumber: string;
  tripIndex: number;
  activities: TripActivity[];
  startTime: string;
  endTime: string;
  savedCount: number;
  skippedCount: number;
  // Per-category counters for detailed logging
  savedIgnitionOn: number;
  savedIgnitionOff: number;
  savedMovingLocationChanges: number;
  savedIdleMilestones: number;
  savedStationaryMilestones: number;
  skippedSameLocation: number;
  skippedIdleNotMilestone: number;
  skippedDuplicate: number;
  rawActivityCount: number;
  // Whether detailed activities were retrieved (vs just summary)
  hasDetailedActivities: boolean;
}

// ── Status Normalization ──────────────────────────────────────

function normalizeStatus(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const s = String(raw).trim().toLowerCase();
  if (['moving', 'driving', 'moving_left', 'moving_right'].includes(s)) return 'Moving';
  if (['idling', 'idle', 'idle_left', 'idle_right', 'idling_left', 'idling_right'].includes(s)) return 'Idling';
  if (['stationary', 'stopped', 'parked', 'stationary_left', 'stationary_right'].includes(s)) return 'Stationary';
  return null;
}

// ── Helpers ────────────────────────────────────────────────────

function msToManilaTimeString(ms: number): string {
  const d = new Date(ms);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);

  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

function msToManilaTimeShort(ms: number): string {
  const d = new Date(ms);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  return `${get('hour')}:${get('minute')}:${get('second')}`;
}

function extractTimestampMs(point: CartrackHistoryPoint): number | null {
  const clockVal = point.clock;
  if (clockVal !== undefined && clockVal !== null) {
    if (typeof clockVal === 'number') {
      return clockVal < 1e12 ? clockVal * 1000 : clockVal;
    }
    if (typeof clockVal === 'string') {
      const d = new Date(clockVal);
      if (!Number.isNaN(d.getTime())) return d.getTime();
    }
  }

  const raw = String(
    point.Time ??
    point.time ??
    point.event_time ??
    point.timestamp ??
    point.start_timestamp ??
    point.start_time ??
    point.startTime ??
    point.end_timestamp ??
    point.end_time ??
    point.endTime ??
    point.event_ts ??
    '',
  );
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

function extractTimeStr(point: CartrackHistoryPoint): string | null {
  const ms = extractTimestampMs(point);
  return ms !== null ? msToManilaTimeString(ms) : null;
}

function extractDateStr(point: CartrackHistoryPoint): string | null {
  const ms = extractTimestampMs(point);
  if (ms === null) return null;
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function deriveStatus(point: CartrackHistoryPoint): string {
  const statusRaw = point.Status ?? point.status;
  if (statusRaw) {
    const normalized = normalizeStatus(String(statusRaw));
    if (normalized) return normalized;
  }

  const speed = Number(point['Road Speed'] ?? point.road_speed ?? point.speed ?? 0);
  if (speed > 0) return 'Moving';

  const ignition = point.ignition ?? point.Ignition;
  if (ignition === true || ignition === 1 || ignition === '1' || ignition === 'true') return 'Idling';

  return 'Stationary';
}

function deriveRoadSpeed(point: CartrackHistoryPoint): number | null {
  const raw = point['Road Speed'] ?? point.road_speed ?? point.speed ?? point.speed_kph;
  if (raw === undefined || raw === null) return null;
  const speed = Number(raw);
  return Number.isFinite(speed) ? speed : null;
}

function deriveFuel(point: CartrackHistoryPoint): number | null {
  const raw = point.Fuel ?? point.fuel ?? point.fuel_level ?? point.fuelLevel;
  if (raw === undefined || raw === null) return null;
  const fuel = Number(raw);
  return Number.isFinite(fuel) ? fuel : null;
}

function deriveEvent(point: CartrackHistoryPoint): string | null {
  const raw = point.Events ?? point.events ?? point.event;
  if (raw === undefined || raw === null) return null;
  return String(raw).trim() || null;
}

function deriveLocation(point: CartrackHistoryPoint): string | null {
  const raw = point.Location ?? point.location ?? point.address ?? point.location_name;
  if (raw === undefined || raw === null) return null;
  return String(raw).trim() || null;
}

function deriveLatitude(point: CartrackHistoryPoint): number | null {
  const raw = point.Latitude ?? point.latitude;
  if (raw === undefined || raw === null) return null;
  const lat = Number(raw);
  return Number.isFinite(lat) ? lat : null;
}

function deriveLongitude(point: CartrackHistoryPoint): number | null {
  const raw = point.Longitude ?? point.longitude;
  if (raw === undefined || raw === null) return null;
  const lon = Number(raw);
  return Number.isFinite(lon) ? lon : null;
}

function deriveFleetTripId(point: CartrackHistoryPoint): string | null {
  const raw = point.id ?? point.trip_id ?? point.tripId;
  if (raw === undefined || raw === null) return null;
  return String(raw);
}

// ── Normalize a raw Cartrack point ─────────────────────────────

function normalizeRecord(
  point: CartrackHistoryPoint,
): NormalizedRecord | null {
  const eventTimeMs = extractTimestampMs(point);
  if (eventTimeMs === null) return null;

  const eventTime = msToManilaTimeString(eventTimeMs);
  const tripDate = extractDateStr(point);
  const status = deriveStatus(point);
  const event = deriveEvent(point);
  const roadSpeed = deriveRoadSpeed(point);
  const location = deriveLocation(point);
  const latitude = deriveLatitude(point);
  const longitude = deriveLongitude(point);
  const fuel = deriveFuel(point);
  const fleetTripId = deriveFleetTripId(point);

  return {
    eventTimeMs,
    eventTime,
    tripDate,
    status,
    event,
    roadSpeed,
    location,
    latitude,
    longitude,
    fuel,
    fleetTripId,
    rawPoint: point,
  };
}

// ── Validate required fields ───────────────────────────────────
//
// A record is valid if it has:
//   timestamp AND (status OR action OR event)
//
// Latitude/longitude are OPTIONAL.

interface ValidationResult {
  valid: boolean;
  reason?: string;
}

function validateRequiredFields(normalized: NormalizedRecord, vehicleId: string): ValidationResult {
  if (!vehicleId) {
    return { valid: false, reason: 'Missing vehicle_id' };
  }
  if (!normalized.eventTime) {
    return { valid: false, reason: 'Missing event_time' };
  }
  if (!normalized.status && !normalized.event) {
    return { valid: false, reason: 'Missing both status and event - at least one required' };
  }
  return { valid: true };
}

// ── Idle/Stationary Session Tracker ────────────────────────────
//
// Milestones: 10min, +15min (25min), +30min (55min), +30min (85min), ...

interface MilestoneSession {
  startMs: number;
  nextMilestoneMs: number; // The next milestone threshold in ms from start
  milestoneStep: number;   // Which step we're on (0=10min, 1=25min, 2=55min, 3=85min...)
}

function getNextMilestoneMs(currentStep: number): number {
  if (currentStep < IDLE_MILESTONE_INTERVALS_MINUTES.length) {
    // Use predefined intervals: 10, 15
    return IDLE_MILESTONE_INTERVALS_MINUTES[currentStep] * 60 * 1000;
  }
  // Repeating interval: 30 minutes
  return REPEATING_MILESTONE_INTERVAL_MINUTES * 60 * 1000;
}

function getCumulativeMilestoneMs(step: number): number {
  let total = 0;
  for (let i = 0; i <= step; i++) {
    total += getNextMilestoneMs(i);
  }
  return total;
}

// ── Travel Order Linking ───────────────────────────────────────

async function findTravelOrderForEvent(
  vehicleId: string | null,
  eventTimeMs: number,
  latitude: number | null,
  longitude: number | null,
): Promise<string | null> {
  if (!vehicleId) return null;

  const d = new Date(eventTimeMs);
  const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  try {
    const candidates = await findAllTravelOrdersForDate(vehicleId, dateStr);
    if (!candidates || candidates.length === 0) return null;

    const eventTimeStr = msToManilaTimeString(eventTimeMs);
    const coordStr = (latitude !== null && longitude !== null)
      ? `${latitude.toFixed(6)},${longitude.toFixed(6)}`
      : null;

    const matched = matchTravelOrderToGpsTrip(
      eventTimeStr,
      eventTimeStr,
      coordStr,
      candidates,
    );

    return matched?.id ?? null;
  } catch (err) {
    console.error('[FleetTripHistory] Error linking travel order:', (err as Error).message);
    return null;
  }
}

// ── Detect Ignition Events ─────────────────────────────────────

function detectIgnitionOn(point: CartrackHistoryPoint): boolean {
  const raw = point.ignition ?? point.Ignition;
  if (raw === undefined || raw === null) return false;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw > 0;
  if (typeof raw === 'string') {
    const lower = raw.toLowerCase();
    return lower === 'true' || lower === '1' || lower === 'on' || lower === 'yes';
  }
  return false;
}

function detectIgnitionOff(point: CartrackHistoryPoint): boolean {
  const raw = point.ignition ?? point.Ignition;
  if (raw === undefined || raw === null) return false;
  if (typeof raw === 'boolean') return !raw;
  if (typeof raw === 'number') return raw === 0;
  if (typeof raw === 'string') {
    const lower = raw.toLowerCase();
    return lower === 'false' || lower === '0' || lower === 'off' || lower === 'no';
  }
  return false;
}

// ── Create Summary-Only Trip (Ignition ON/OFF boundaries) ──────
//
// When no detail endpoint is available, create a minimal trip with
// only the ignition boundary records from the trip summary.

function createSummaryTrip(
  summary: CartrackHistoryPoint,
  vehicleId: string,
  plateNumber: string,
  tripIndex: number,
): TripInfo {
  const startMs = extractTimestampMs(summary);
  const endMs = startMs !== null ? startMs + 3600000 : null;

  const endTs = String(
    summary.end_timestamp ?? summary.end_time ?? summary.endTime ?? ''
  );
  const endDate = endTs ? new Date(endTs) : null;
  const actualEndMs = (endDate && !Number.isNaN(endDate.getTime())) ? endDate.getTime() : endMs;

  const startTime = startMs ? msToManilaTimeString(startMs) : 'Unknown';
  const endTime = actualEndMs ? msToManilaTimeString(actualEndMs) : 'Unknown';

  const startLocation = deriveLocation(summary) || 'Unknown';
  const endLocation = summary.end_location ?? summary.endLocation ?? summary.destination ?? 'Unknown';

  const ignitionOnActivity: TripActivity = {
    eventTimeMs: startMs || 0,
    eventTime: startTime,
    tripDate: extractDateStr(summary),
    status: 'Moving',
    event: 'Ignition ON',
    roadSpeed: null,
    location: startLocation,
    latitude: deriveLatitude(summary),
    longitude: deriveLongitude(summary),
    fuel: deriveFuel(summary),
    fleetTripId: deriveFleetTripId(summary),
    rawPoint: summary,
    isIgnitionOn: true,
    isIgnitionOff: false,
  };

  const ignitionOffActivity: TripActivity = {
    eventTimeMs: actualEndMs || (startMs ? startMs + 3600000 : 0),
    eventTime: endTime,
    tripDate: extractDateStr(summary),
    status: 'Stationary',
    event: 'Ignition OFF',
    roadSpeed: null,
    location: endLocation,
    latitude: null,
    longitude: null,
    fuel: null,
    fleetTripId: deriveFleetTripId(summary),
    rawPoint: summary,
    isIgnitionOn: false,
    isIgnitionOff: true,
  };

  return {
    vehicleId,
    plateNumber,
    tripIndex,
    activities: [ignitionOnActivity, ignitionOffActivity],
    startTime,
    endTime,
    savedCount: 0,
    skippedCount: 0,
    savedIgnitionOn: 0,
    savedIgnitionOff: 0,
    savedMovingLocationChanges: 0,
    savedIdleMilestones: 0,
    savedStationaryMilestones: 0,
    skippedSameLocation: 0,
    skippedIdleNotMilestone: 0,
    skippedDuplicate: 0,
    rawActivityCount: 2,
    hasDetailedActivities: false,
  };
}

// ── Parse Detailed Activity Rows into Trip Activities ──────────
//
// Takes the detailed fleet trip history rows (Time, Status, Events, Location)
// and converts them into TripActivity records with proper ignition detection.

function parseDetailedActivities(
  detailPoints: CartrackHistoryPoint[],
  vehicleId: string,
  plateNumber: string,
  tripIndex: number,
  startTime: string,
  endTime: string,
): TripActivity[] {
  const activities: TripActivity[] = [];

  for (const point of detailPoints) {
    const normalized = normalizeRecord(point);
    if (!normalized) continue;

    const eventStr = deriveEvent(point) || '';
    const isIgnitionOn = eventStr.toLowerCase().includes('ignition on') || detectIgnitionOn(point);
    const isIgnitionOff = eventStr.toLowerCase().includes('ignition off') || detectIgnitionOff(point);

    activities.push({
      ...normalized,
      isIgnitionOn,
      isIgnitionOff,
    });
  }

  // If no explicit ignition events found, mark first as Ignition ON and last as Ignition OFF
  if (activities.length > 0) {
    const hasIgnitionOn = activities.some(a => a.isIgnitionOn);
    const hasIgnitionOff = activities.some(a => a.isIgnitionOff);

    if (!hasIgnitionOn) {
      activities[0].isIgnitionOn = true;
      if (!activities[0].event) {
        activities[0].event = 'Ignition ON';
      }
    }

    if (!hasIgnitionOff) {
      activities[activities.length - 1].isIgnitionOff = true;
      if (!activities[activities.length - 1].event) {
        activities[activities.length - 1].event = 'Ignition OFF';
      }
    }
  }

  return activities;
}

// ── Trip Overlap Detection ─────────────────────────────────────
//
// A single vehicle cannot have overlapping ignition cycles.
// If duplicate/overlapping trips exist, keep the most detailed trip
// (the one with more activities) and discard duplicate summaries.

interface TripOverlapInfo {
  trip: TripInfo;
  startMs: number;
  endMs: number;
  activityCount: number;
}

function resolveOverlappingTrips(trips: TripInfo[]): TripInfo[] {
  if (trips.length <= 1) return trips;

  // Build overlap info with timestamps
  const tripInfos: TripOverlapInfo[] = trips.map(trip => ({
    trip,
    startMs: extractTimestampMsFromTrip(trip, 'start') || 0,
    endMs: extractTimestampMsFromTrip(trip, 'end') || 0,
    activityCount: trip.activities.length,
  }));

  // Sort by start time
  tripInfos.sort((a, b) => a.startMs - b.startMs);

  // Detect and resolve overlaps
  const resolved: TripInfo[] = [];
  let i = 0;

  while (i < tripInfos.length) {
    let current = tripInfos[i];
    let j = i + 1;

    // Check for overlapping trips
    while (j < tripInfos.length && tripInfos[j].startMs < current.endMs) {
      // Overlap detected - keep the one with more activities
      if (tripInfos[j].activityCount > current.activityCount) {
        console.log(`   🔄 Overlap: Trip #${current.trip.tripIndex} (${current.activityCount} acts) < Trip #${tripInfos[j].trip.tripIndex} (${tripInfos[j].activityCount} acts) → keeping detailed`);
        current = tripInfos[j];
      } else {
        console.log(`   🔄 Overlap: Trip #${tripInfos[j].trip.tripIndex} (${tripInfos[j].activityCount} acts) < Trip #${current.trip.tripIndex} (${current.activityCount} acts) → keeping detailed`);
      }
      j++;
    }

    resolved.push(current.trip);
    i = j;
  }

  // Re-index trips
  resolved.forEach((trip, idx) => {
    trip.tripIndex = idx + 1;
  });

  return resolved;
}

function extractTimestampMsFromTrip(trip: TripInfo, which: 'start' | 'end'): number | null {
  const timeStr = which === 'start' ? trip.startTime : trip.endTime;
  if (!timeStr || timeStr === 'Unknown') return null;
  const d = new Date(timeStr);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

// ── Main Sync Function ─────────────────────────────────────────

/**
 * Synchronize fleet trip history for a specific vehicle on a specific date.
 *
 * Flow:
 *   1. Fetch trip summaries from /rest/trips/{plate} (discovery only)
 *   2. For each summary, extract trip_id
 *   3. Call Cartrack trip detail/history endpoint for that trip_id
 *   4. If details available → parse and apply full save rules
 *   5. If no details → report and save only ignition boundaries
 */
export async function syncFleetTripHistory(
  vehicleId: string,
  plateNumber: string,
  dateStr: string,
): Promise<SyncResult> {
  const statistics: SyncStatistics = {
    fetched: 0,
    tripSummariesFetched: 0,
    detailedTripsRetrieved: 0,
    rawActivitiesRetrieved: 0,
    saved: 0,
    stationarySkipped: 0,
    duplicateSkipped: 0,
    movingSkippedNoLocationChange: 0,
    idleSkippedNotMilestone: 0,
    invalidData: 0,
    errors: 0,
  };

  try {
    // ── Step 1: Resolve Cartrack unit ID ──
    const unitInfo = await resolveCartrackUnitId(plateNumber);
    if (!unitInfo) {
      return {
        success: false,
        statistics,
        message: `Could not resolve Cartrack unit ID for plate ${plateNumber}`,
      };
    }

    // ── Step 2: Fetch trip summaries from /rest/trips/{plate} ──
    // This endpoint ONLY returns trip summaries (start/end timestamps, locations).
    // It does NOT return detailed activity rows.
    const rawPoints = await fetchCartrackVehicleHistory(plateNumber, dateStr, dateStr);
    if (!rawPoints || rawPoints.length === 0) {
      return {
        success: true,
        statistics,
        message: `No fleet trip history data found for ${plateNumber} on ${dateStr}`,
      };
    }

    statistics.fetched = rawPoints.length;
    console.log(`\n${'═'.repeat(70)}`);
    console.log(`📡 FLEET TRIP HISTORY SYNC`);
    console.log(`   Vehicle: ${plateNumber} (ID: ${vehicleId})`);
    console.log(`   Date: ${dateStr}`);
    console.log(`   Fetched Records: ${rawPoints.length}`);
    console.log(`${'═'.repeat(70)}`);

    // Log sample record for debugging
    if (rawPoints.length > 0) {
      const sample = rawPoints[0];
      console.log(`\n📋 Sample record keys: ${Object.keys(sample).join(', ')}`);
    }

    // ── Step 3: Extract trip summaries ──
    // /rest/trips returns trip summaries. Filter to only those.
    const summaries = rawPoints.filter(p => looksLikeTripSummary(p));
    if (summaries.length === 0) {
      return {
        success: true,
        statistics,
        message: `No trip summaries found in ${rawPoints.length} records for ${plateNumber} on ${dateStr}`,
      };
    }

    statistics.tripSummariesFetched = summaries.length;
    console.log(`\n📊 Found ${summaries.length} trip summary(ies) from /rest/trips endpoint\n`);

    // ── Step 4: For each trip summary, fetch detailed activities ──
    const trips: TripInfo[] = [];

    for (let i = 0; i < summaries.length; i++) {
      const summary = summaries[i];
      const tripId = deriveFleetTripId(summary);
      const startMs = extractTimestampMs(summary);
      const startTime = startMs ? msToManilaTimeString(startMs) : 'Unknown';
      const endTs = String(summary.end_timestamp ?? summary.end_time ?? summary.endTime ?? '');
      const endDate = endTs ? new Date(endTs) : null;
      const endTime = (endDate && !Number.isNaN(endDate.getTime())) ? msToManilaTimeString(endDate.getTime()) : 'Unknown';

      console.log(`\n${'─'.repeat(60)}`);
      console.log(`🚗 Trip #${i + 1}`);
      console.log(`   Vehicle: ${plateNumber}`);
      console.log(`   Start: ${msToManilaTimeShort(startMs || 0)}`);
      console.log(`   End: ${msToManilaTimeShort(endDate?.getTime() || 0)}`);
      console.log(`   Trip ID: ${tripId || 'N/A'}`);
      console.log(`${'─'.repeat(60)}`);

      if (!tripId) {
        console.log(`   ⚠️ No trip_id found in summary — cannot fetch details. Saving ignition boundaries only.`);
        trips.push(createSummaryTrip(summary, vehicleId, plateNumber, i + 1));
        continue;
      }

      // Call the Cartrack trip detail/history endpoint for this trip_id
      console.log(`   🔍 Fetching detailed activities for trip_id=${tripId}...`);
      const detailPoints = await fetchDetailedPointsForTrip(
        unitInfo.unitId,
        plateNumber,
        summary,
      );

      if (detailPoints.length === 0) {
        console.log(`   ⚠️ No detail endpoint available for trip_id=${tripId}.`);
        console.log(`   ⚠️ Only trip summaries are available — saving ignition boundary records only.`);
        trips.push(createSummaryTrip(summary, vehicleId, plateNumber, i + 1));
        continue;
      }

      // Check if the detail points are actual fleet history rows
      // (Time, Status, Events, Location, Latitude, Longitude)
      const hasFleetHistoryFields = detailPoints.some(p => looksLikeFleetTripHistoryRow(p));

      if (!hasFleetHistoryFields) {
        console.log(`   ⚠️ Detail endpoint returned data but it lacks required fleet history fields.`);
        console.log(`   ⚠️ Only trip summaries are available — saving ignition boundary records only.`);
        trips.push(createSummaryTrip(summary, vehicleId, plateNumber, i + 1));
        continue;
      }

      // Parse detailed activities from the fleet history rows
      const detailedActivities = parseDetailedActivities(
        detailPoints,
        vehicleId,
        plateNumber,
        i + 1,
        startTime,
        endTime,
      );

      if (detailedActivities.length === 0) {
        console.log(`   ⚠️ No activities could be parsed from detail endpoint. Saving ignition boundaries only.`);
        trips.push(createSummaryTrip(summary, vehicleId, plateNumber, i + 1));
        continue;
      }

      statistics.detailedTripsRetrieved++;
      statistics.rawActivitiesRetrieved += detailedActivities.length;

      trips.push({
        vehicleId,
        plateNumber,
        tripIndex: i + 1,
        activities: detailedActivities,
        startTime,
        endTime,
        savedCount: 0,
        skippedCount: 0,
        savedIgnitionOn: 0,
        savedIgnitionOff: 0,
        savedMovingLocationChanges: 0,
        savedIdleMilestones: 0,
        savedStationaryMilestones: 0,
        skippedSameLocation: 0,
        skippedIdleNotMilestone: 0,
        skippedDuplicate: 0,
        rawActivityCount: detailedActivities.length,
        hasDetailedActivities: true,
      });

      console.log(`   ✅ Retrieved ${detailedActivities.length} detailed activities for Trip #${i + 1}`);
    }

    // ── Step 5: Resolve overlapping trips ──
    const resolvedTrips = resolveOverlappingTrips(trips);

    // ── Step 6: Process each trip ──
    const pool = getPool();
    let totalSaved = 0;
    let totalSkipped = 0;
    let totalGeneratedEvents = 0;

    for (let tripIdx = 0; tripIdx < resolvedTrips.length; tripIdx++) {
      totalGeneratedEvents += resolvedTrips[tripIdx].activities.length;
      const trip = resolvedTrips[tripIdx];
      const activities = trip.activities;

      console.log(`\n${'═'.repeat(60)}`);
      console.log(`🚗 Trip #${trip.tripIndex}`);
      console.log(`   Vehicle: ${trip.plateNumber}`);
      console.log(`   Start: ${msToManilaTimeShort(extractTimestampMsFromTrip(trip, 'start') || 0)}`);
      console.log(`   End: ${msToManilaTimeShort(extractTimestampMsFromTrip(trip, 'end') || 0)}`);
      console.log(`   Activities: ${activities.length}${trip.hasDetailedActivities ? ' (detailed)' : ' (summary only)'}`);
      console.log(`${'─'.repeat(60)}`);

      // Track state for this trip
      let lastSavedMovingLocation: string | null = null;
      let milestoneSession: MilestoneSession | null = null;
      let tripSavedCount = 0;
      let tripSkippedCount = 0;

      // Per-category counters
      let savedIgnitionOn = 0;
      let savedIgnitionOff = 0;
      let savedMovingLocationChanges = 0;
      let savedIdleMilestones = 0;
      let savedStationaryMilestones = 0;
      let skippedSameLocation = 0;
      let skippedIdleNotMilestone = 0;
      let skippedDuplicate = 0;

      for (let actIdx = 0; actIdx < activities.length; actIdx++) {
        const activity = activities[actIdx];
        const { eventTimeMs: ts, eventTime, tripDate, status, event, roadSpeed, location, latitude, longitude, fuel, fleetTripId, isIgnitionOn, isIgnitionOff } = activity;

        // ── Validate ──
        const validation = validateRequiredFields(activity, vehicleId);
        if (!validation.valid) {
          statistics.invalidData++;
          tripSkippedCount++;
          continue;
        }

        // ── Rule 1: Always save Ignition ON ──
        if (isIgnitionOn) {
          const saveResult = await saveFleetRecord(
            pool, vehicleId, tripDate, eventTime, ts,
            status, 'Ignition ON', roadSpeed, location,
            latitude, longitude, fuel, fleetTripId, activity.rawPoint,
          );
          if (saveResult === 'saved') {
            statistics.saved++;
            tripSavedCount++;
            savedIgnitionOn++;
            lastSavedMovingLocation = location;
          } else if (saveResult === 'duplicate') {
            statistics.duplicateSkipped++;
            tripSkippedCount++;
            skippedDuplicate++;
          } else {
            statistics.errors++;
            tripSkippedCount++;
          }
          milestoneSession = null;
          continue;
        }

        // ── Rule 2: Always save Ignition OFF ──
        if (isIgnitionOff) {
          const saveResult = await saveFleetRecord(
            pool, vehicleId, tripDate, eventTime, ts,
            'Stationary', 'Ignition OFF', roadSpeed, location,
            latitude, longitude, fuel, fleetTripId, activity.rawPoint,
          );
          if (saveResult === 'saved') {
            statistics.saved++;
            tripSavedCount++;
            savedIgnitionOff++;
          } else if (saveResult === 'duplicate') {
            statistics.duplicateSkipped++;
            tripSkippedCount++;
            skippedDuplicate++;
          } else {
            statistics.errors++;
            tripSkippedCount++;
          }
          milestoneSession = null;
          continue;
        }

        // ── Rule 3: Moving - save only when location changes ──
        if (status === 'Moving') {
          milestoneSession = null;

          const locationChanged = (
            location !== null &&
            location !== lastSavedMovingLocation
          );

          if (!locationChanged) {
            statistics.movingSkippedNoLocationChange++;
            tripSkippedCount++;
            skippedSameLocation++;
            continue;
          }

          const saveResult = await saveFleetRecord(
            pool, vehicleId, tripDate, eventTime, ts,
            status, event, roadSpeed, location,
            latitude, longitude, fuel, fleetTripId, activity.rawPoint,
          );
          if (saveResult === 'saved') {
            statistics.saved++;
            tripSavedCount++;
            savedMovingLocationChanges++;
            lastSavedMovingLocation = location;
          } else if (saveResult === 'duplicate') {
            statistics.duplicateSkipped++;
            tripSkippedCount++;
            skippedDuplicate++;
          } else {
            statistics.errors++;
            tripSkippedCount++;
          }
          continue;
        }

        // ── Rule 4: Idle - save at milestones ──
        if (status === 'Idling') {
          if (milestoneSession === null) {
            milestoneSession = {
              startMs: ts,
              nextMilestoneMs: getCumulativeMilestoneMs(0), // 10 min
              milestoneStep: 0,
            };
            statistics.idleSkippedNotMilestone++;
            tripSkippedCount++;
            skippedIdleNotMilestone++;
            continue;
          }

          const elapsedMs = ts - milestoneSession.startMs;

          if (elapsedMs >= milestoneSession.nextMilestoneMs) {
            const saveResult = await saveFleetRecord(
              pool, vehicleId, tripDate, eventTime, ts,
              status, event, roadSpeed, location,
              latitude, longitude, fuel, fleetTripId, activity.rawPoint,
            );
            if (saveResult === 'saved') {
              statistics.saved++;
              tripSavedCount++;
              savedIdleMilestones++;
              milestoneSession.milestoneStep++;
              milestoneSession.nextMilestoneMs = getCumulativeMilestoneMs(milestoneSession.milestoneStep);
            } else if (saveResult === 'duplicate') {
              statistics.duplicateSkipped++;
              tripSkippedCount++;
              skippedDuplicate++;
            } else {
              statistics.errors++;
              tripSkippedCount++;
            }
          } else {
            statistics.idleSkippedNotMilestone++;
            tripSkippedCount++;
            skippedIdleNotMilestone++;
          }
          continue;
        }

        // ── Rule 5: Stationary - save at milestones (same as idle) ──
        if (status === 'Stationary') {
          if (milestoneSession === null) {
            milestoneSession = {
              startMs: ts,
              nextMilestoneMs: getCumulativeMilestoneMs(0), // 10 min
              milestoneStep: 0,
            };
            statistics.stationarySkipped++;
            tripSkippedCount++;
            continue;
          }

          const elapsedMs = ts - milestoneSession.startMs;

          if (elapsedMs >= milestoneSession.nextMilestoneMs) {
            const saveResult = await saveFleetRecord(
              pool, vehicleId, tripDate, eventTime, ts,
              status, event, roadSpeed, location,
              latitude, longitude, fuel, fleetTripId, activity.rawPoint,
            );
            if (saveResult === 'saved') {
              statistics.saved++;
              tripSavedCount++;
              savedStationaryMilestones++;
              milestoneSession.milestoneStep++;
              milestoneSession.nextMilestoneMs = getCumulativeMilestoneMs(milestoneSession.milestoneStep);
            } else if (saveResult === 'duplicate') {
              statistics.duplicateSkipped++;
              tripSkippedCount++;
              skippedDuplicate++;
            } else {
              statistics.errors++;
              tripSkippedCount++;
            }
          } else {
            statistics.stationarySkipped++;
            tripSkippedCount++;
          }
          continue;
        }

        // ── Fallback: Unknown status - try to save anyway if it has an event ──
        if (event) {
          const saveResult = await saveFleetRecord(
            pool, vehicleId, tripDate, eventTime, ts,
            status, event, roadSpeed, location,
            latitude, longitude, fuel, fleetTripId, activity.rawPoint,
          );
          if (saveResult === 'saved') {
            statistics.saved++;
            tripSavedCount++;
          } else if (saveResult === 'duplicate') {
            statistics.duplicateSkipped++;
            tripSkippedCount++;
            skippedDuplicate++;
          } else {
            statistics.errors++;
            tripSkippedCount++;
          }
        } else {
          statistics.invalidData++;
          tripSkippedCount++;
        }
      }

      // Update trip stats
      trip.savedCount = tripSavedCount;
      trip.skippedCount = tripSkippedCount;
      trip.savedIgnitionOn = savedIgnitionOn;
      trip.savedIgnitionOff = savedIgnitionOff;
      trip.savedMovingLocationChanges = savedMovingLocationChanges;
      trip.savedIdleMilestones = savedIdleMilestones;
      trip.savedStationaryMilestones = savedStationaryMilestones;
      trip.skippedSameLocation = skippedSameLocation;
      trip.skippedIdleNotMilestone = skippedIdleNotMilestone;
      trip.skippedDuplicate = skippedDuplicate;
      totalSaved += tripSavedCount;
      totalSkipped += tripSkippedCount;

      // Log per-trip detailed summary
      console.log(`\n   Saved:`);
      if (savedIgnitionOn > 0) console.log(`   ✓ Ignition ON`);
      if (savedMovingLocationChanges > 0) console.log(`   ✓ Moving location changes: ${savedMovingLocationChanges}`);
      if (savedIdleMilestones > 0) console.log(`   ✓ Idle milestones: ${savedIdleMilestones}`);
      if (savedStationaryMilestones > 0) console.log(`   ✓ Stationary milestones: ${savedStationaryMilestones}`);
      if (savedIgnitionOff > 0) console.log(`   ✓ Ignition OFF`);
      console.log(``);
      console.log(`   Skipped:`);
      if (skippedSameLocation > 0) console.log(`   - Same location movement: ${skippedSameLocation}`);
      if (skippedIdleNotMilestone > 0) console.log(`   - Idle not milestone: ${skippedIdleNotMilestone}`);
      if (skippedDuplicate > 0) console.log(`   - Duplicate: ${skippedDuplicate}`);
    }

    // ── Accounting Validation ──
    const totalProcessed = statistics.saved
      + statistics.stationarySkipped
      + statistics.duplicateSkipped
      + statistics.movingSkippedNoLocationChange
      + statistics.idleSkippedNotMilestone
      + statistics.invalidData
      + statistics.errors;

    if (totalProcessed !== totalGeneratedEvents) {
      console.warn(`\n⚠️  ACCOUNTING MISMATCH - Generated Events: ${totalGeneratedEvents}, Total processed: ${totalProcessed}`);
    }

    // ── Final Summary ──
    console.log(`\n${'═'.repeat(70)}`);
    console.log(`📊 SYNC SUMMARY for ${plateNumber} on ${dateStr}`);
    console.log(`${'═'.repeat(70)}`);
    console.log(`   Trip Summaries Fetched:     ${statistics.tripSummariesFetched}`);
    console.log(`   Detailed Trips Retrieved:   ${statistics.detailedTripsRetrieved}`);
    console.log(`   Raw Activities Retrieved:   ${statistics.rawActivitiesRetrieved}`);
    console.log(`   Saved Fleet History Records: ${statistics.saved}`);
    console.log(`   ─────────────────────────────────────`);
    console.log(`   Skipped:`);
    console.log(`   Same Location:              ${statistics.movingSkippedNoLocationChange}`);
    console.log(`   Idle Not Milestone:         ${statistics.idleSkippedNotMilestone}`);
    console.log(`   Duplicate:                  ${statistics.duplicateSkipped}`);
    console.log(`   Stationary Skipped:         ${statistics.stationarySkipped}`);
    console.log(`   Invalid Data:               ${statistics.invalidData}`);
    console.log(`   Errors:                     ${statistics.errors}`);
    console.log(`${'═'.repeat(70)}`);

    return {
      success: true,
      statistics,
      message: `Sync completed for ${plateNumber} on ${dateStr}. ${resolvedTrips.length} trip(s), ${statistics.saved} records saved.`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[FleetTripHistory] Sync error:', message);
    if (err instanceof Error && err.stack) console.error(err.stack);
    return {
      success: false,
      statistics,
      message: `Sync failed: ${message}`,
    };
  }
}

// ── Save result type ────────────────────────────────────────────

type SaveResult = 'saved' | 'duplicate' | 'error';

// ── Save Fleet Record ──────────────────────────────────────────
//
// Inserts or updates a record in fleet_trip_history.
// Duplicate detection uses: vehicle_id + event_time + status + location
//
// Returns:
//   'saved'     → record was inserted or updated successfully
//   'duplicate' → unique constraint violation (record already exists with same key)
//   'error'     → database error (e.g. missing column, connection issue)

async function saveFleetRecord(
  pool: any,
  vehicleId: string,
  tripDate: string | null,
  eventTime: string,
  eventTimeMs: number,
  status: string,
  event: string | null,
  roadSpeed: number | null,
  location: string | null,
  latitude: number | null,
  longitude: number | null,
  fuel: number | null,
  fleetTripId: string | null,
  rawPoint: CartrackHistoryPoint,
): Promise<SaveResult> {
  try {
    // Link travel order
    const travelOrderId = await findTravelOrderForEvent(
      vehicleId,
      eventTimeMs,
      latitude,
      longitude,
    );

    // Extract all available telemetry fields from raw point
    const gpsSignal = String(rawPoint.gps_signal ?? rawPoint.gpsSignal ?? rawPoint['GPS Signal'] ?? '') || null;
    const rpm = rawPoint.rpm ?? rawPoint.RPM ?? null;
    const driver = String(rawPoint.driver ?? rawPoint.Driver ?? rawPoint.driver_name ?? rawPoint.driverName ?? '') || null;
    const odometer = rawPoint.odometer ?? rawPoint.Odometer ?? null;
    const geofence = String(rawPoint.geofence ?? rawPoint.Geofence ?? rawPoint.geo_fence ?? '') || null;
    const xAccel = rawPoint.x_accel ?? rawPoint.xAccel ?? null;
    const yAccel = rawPoint.y_accel ?? rawPoint.yAccel ?? null;
    const zAccel = rawPoint.z_accel ?? rawPoint.zAccel ?? null;
    const unitTemp = rawPoint.unit_temp ?? rawPoint.unitTemp ?? rawPoint['Unit Temp'] ?? null;
    const waterTemp = rawPoint.water_temp ?? rawPoint.waterTemp ?? rawPoint['Water Temp'] ?? null;
    const oilTemp = rawPoint.oil_temp ?? rawPoint.oilTemp ?? rawPoint['Oil Temp'] ?? null;
    const oilPressure = rawPoint.oil_pressure ?? rawPoint.oilPressure ?? rawPoint['Oil Pressure'] ?? null;
    const manifoldPressure = rawPoint.manifold_pressure ?? rawPoint.manifoldPressure ?? rawPoint['Manifold Pressure'] ?? null;
    const temp1 = rawPoint.temp_1 ?? rawPoint.temp1 ?? rawPoint['Temp 1'] ?? null;
    const temp2 = rawPoint.temp_2 ?? rawPoint.temp2 ?? rawPoint['Temp 2'] ?? null;
    const temp3 = rawPoint.temp_3 ?? rawPoint.temp3 ?? rawPoint['Temp 3'] ?? null;
    const temp4 = rawPoint.temp_4 ?? rawPoint.temp4 ?? rawPoint['Temp 4'] ?? null;
    const clock = rawPoint.clock ?? rawPoint.Clock ?? null;
    const clockMinute = rawPoint.clock_minute ?? rawPoint.clockMinute ?? rawPoint['Clock Minute'] ?? null;
    const clockRaw = rawPoint.clock_raw ?? rawPoint.clockRaw ?? rawPoint['Clock Raw'] ?? null;
    const fuelUsed = rawPoint.fuel_used ?? rawPoint.fuelUsed ?? rawPoint['Fuel Used'] ?? null;
    const vision = String(rawPoint.vision ?? rawPoint.Vision ?? '') || null;
    const actions = String(rawPoint.actions ?? rawPoint.Actions ?? rawPoint.action ?? '') || null;

    const result = await pool.query(
      `INSERT INTO fleet_trip_history
        (travel_order_id, vehicle_id, driver_id, fleet_trip_id,
         event_time, trip_date, status, event,
         road_speed, location, latitude, longitude, fuel,
         gps_signal, rpm, odometer, geofence,
         x_accel, y_accel, z_accel,
         unit_temp, water_temp, oil_temp, oil_pressure, manifold_pressure,
         temp_1, temp_2, temp_3, temp_4,
         clock, clock_minute, clock_raw, fuel_used,
         vision, actions, driver,
         created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
               $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25,
               $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36,
               NOW(), NOW())
       ON CONFLICT (vehicle_id, event_time, status, COALESCE(location, ''))
       DO UPDATE SET
         travel_order_id = COALESCE(EXCLUDED.travel_order_id, fleet_trip_history.travel_order_id),
         event = COALESCE(EXCLUDED.event, fleet_trip_history.event),
         road_speed = COALESCE(EXCLUDED.road_speed, fleet_trip_history.road_speed),
         location = COALESCE(EXCLUDED.location, fleet_trip_history.location),
         fuel = COALESCE(EXCLUDED.fuel, fleet_trip_history.fuel),
         latitude = COALESCE(EXCLUDED.latitude, fleet_trip_history.latitude),
         longitude = COALESCE(EXCLUDED.longitude, fleet_trip_history.longitude),
         gps_signal = COALESCE(EXCLUDED.gps_signal, fleet_trip_history.gps_signal),
         rpm = COALESCE(EXCLUDED.rpm, fleet_trip_history.rpm),
         odometer = COALESCE(EXCLUDED.odometer, fleet_trip_history.odometer),
         geofence = COALESCE(EXCLUDED.geofence, fleet_trip_history.geofence),
         x_accel = COALESCE(EXCLUDED.x_accel, fleet_trip_history.x_accel),
         y_accel = COALESCE(EXCLUDED.y_accel, fleet_trip_history.y_accel),
         z_accel = COALESCE(EXCLUDED.z_accel, fleet_trip_history.z_accel),
         unit_temp = COALESCE(EXCLUDED.unit_temp, fleet_trip_history.unit_temp),
         water_temp = COALESCE(EXCLUDED.water_temp, fleet_trip_history.water_temp),
         oil_temp = COALESCE(EXCLUDED.oil_temp, fleet_trip_history.oil_temp),
         oil_pressure = COALESCE(EXCLUDED.oil_pressure, fleet_trip_history.oil_pressure),
         manifold_pressure = COALESCE(EXCLUDED.manifold_pressure, fleet_trip_history.manifold_pressure),
         temp_1 = COALESCE(EXCLUDED.temp_1, fleet_trip_history.temp_1),
         temp_2 = COALESCE(EXCLUDED.temp_2, fleet_trip_history.temp_2),
         temp_3 = COALESCE(EXCLUDED.temp_3, fleet_trip_history.temp_3),
         temp_4 = COALESCE(EXCLUDED.temp_4, fleet_trip_history.temp_4),
         clock = COALESCE(EXCLUDED.clock, fleet_trip_history.clock),
         clock_minute = COALESCE(EXCLUDED.clock_minute, fleet_trip_history.clock_minute),
         clock_raw = COALESCE(EXCLUDED.clock_raw, fleet_trip_history.clock_raw),
         fuel_used = COALESCE(EXCLUDED.fuel_used, fleet_trip_history.fuel_used),
         vision = COALESCE(EXCLUDED.vision, fleet_trip_history.vision),
         actions = COALESCE(EXCLUDED.actions, fleet_trip_history.actions),
         driver = COALESCE(EXCLUDED.driver, fleet_trip_history.driver),
         updated_at = NOW()
       RETURNING id, xmax`,
      [
        travelOrderId,
        vehicleId,
        null, // driver_id - will be resolved from travel order if available
        fleetTripId,
        eventTime,
        tripDate,
        status,
        event,
        roadSpeed,
        location,
        latitude,
        longitude,
        fuel,
        // Telemetry fields
        gpsSignal,
        rpm ? Number(rpm) : null,
        odometer ? Number(odometer) : null,
        geofence,
        xAccel ? Number(xAccel) : null,
        yAccel ? Number(yAccel) : null,
        zAccel ? Number(zAccel) : null,
        unitTemp ? Number(unitTemp) : null,
        waterTemp ? Number(waterTemp) : null,
        oilTemp ? Number(oilTemp) : null,
        oilPressure ? Number(oilPressure) : null,
        manifoldPressure ? Number(manifoldPressure) : null,
        temp1 ? Number(temp1) : null,
        temp2 ? Number(temp2) : null,
        temp3 ? Number(temp3) : null,
        temp4 ? Number(temp4) : null,
        clock ? Number(clock) : null,
        clockMinute ? Number(clockMinute) : null,
        clockRaw ? Number(clockRaw) : null,
        fuelUsed ? Number(fuelUsed) : null,
        vision,
        actions,
        driver,
      ],
    );

    if (result.rows.length > 0) {
      return 'saved';
    }
    return 'duplicate';
  } catch (err: any) {
    if (err?.code === '23505') {
      return 'duplicate';
    }
    console.error(`[FleetTripHistory] ERROR saving record:`, err?.message ?? String(err));
    if (err?.stack) console.error(err.stack);
    return 'error';
  }
}

/**
 * Synchronize fleet trip history for ALL tracked vehicles for today's date.
 */
export async function syncAllVehiclesToday(): Promise<{
  success: boolean;
  totalVehicles: number;
  totalFetched: number;
  totalSaved: number;
  totalStationarySkipped: number;
  totalDuplicateSkipped: number;
  totalMovingSkipped: number;
  totalIdleSkipped: number;
  totalInvalidData: number;
  totalErrors: number;
  results: Array<{ plateNumber: string; statistics: SyncStatistics; success: boolean }>;
  message: string;
}> {
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return syncAllVehiclesFleetTripHistory(dateStr);
}

/**
 * Synchronize fleet trip history for ALL tracked vehicles on a specific date.
 */
export async function syncAllVehiclesFleetTripHistory(
  dateStr: string,
): Promise<{
  success: boolean;
  totalVehicles: number;
  totalFetched: number;
  totalSaved: number;
  totalStationarySkipped: number;
  totalDuplicateSkipped: number;
  totalMovingSkipped: number;
  totalIdleSkipped: number;
  totalInvalidData: number;
  totalErrors: number;
  results: Array<{ plateNumber: string; statistics: SyncStatistics; success: boolean }>;
  message: string;
}> {
  const pool = getPool();
  const vehicles = await pool.query<{ id: string; plate_number: string }>(
    `SELECT id, plate_number FROM vehicles WHERE plate_number IS NOT NULL AND plate_number != ''`,
  );

  let totalFetched = 0;
  let totalSaved = 0;
  let totalStationarySkipped = 0;
  let totalDuplicateSkipped = 0;
  let totalMovingSkipped = 0;
  let totalIdleSkipped = 0;
  let totalInvalidData = 0;
  let totalErrors = 0;
  const results: Array<{ plateNumber: string; statistics: SyncStatistics; success: boolean }> = [];

  for (const vehicle of vehicles.rows) {
    const result = await syncFleetTripHistory(vehicle.id, vehicle.plate_number, dateStr);
    totalFetched += result.statistics.fetched;
    totalSaved += result.statistics.saved;
    totalStationarySkipped += result.statistics.stationarySkipped;
    totalDuplicateSkipped += result.statistics.duplicateSkipped;
    totalMovingSkipped += result.statistics.movingSkippedNoLocationChange;
    totalIdleSkipped += result.statistics.idleSkippedNotMilestone;
    totalInvalidData += result.statistics.invalidData;
    totalErrors += result.statistics.errors;
    results.push({ plateNumber: vehicle.plate_number, statistics: result.statistics, success: result.success });
  }

  return {
    success: true,
    totalVehicles: vehicles.rows.length,
    totalFetched,
    totalSaved,
    totalStationarySkipped,
    totalDuplicateSkipped,
    totalMovingSkipped,
    totalIdleSkipped,
    totalInvalidData,
    totalErrors,
    results,
    message: `Synced ${vehicles.rows.length} vehicles on ${dateStr}`,
  };
}

// ── Query Functions ────────────────────────────────────────────

export interface FleetTripHistoryQueryParams {
  page?: number;
  pageSize?: number;
  vehicleId?: string;
  driverId?: string;
  travelOrderId?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface FleetTripHistoryQueryResult {
  success: boolean;
  data: FleetTripHistoryRow[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Query fleet_trip_history with pagination, filtering, sorting, and search.
 */
export async function queryFleetTripHistory(
  params: FleetTripHistoryQueryParams,
): Promise<FleetTripHistoryQueryResult> {
  const pool = getPool();
  const page = Math.max(1, params.page || 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize || 20));
  const offset = (page - 1) * pageSize;

  const conditions: string[] = [];
  const queryParams: unknown[] = [];
  let paramIndex = 1;

  if (params.vehicleId) {
    conditions.push(`f.vehicle_id = $${paramIndex++}`);
    queryParams.push(params.vehicleId);
  }
  if (params.driverId) {
    conditions.push(`f.driver_id = $${paramIndex++}`);
    queryParams.push(params.driverId);
  }
  if (params.travelOrderId) {
    conditions.push(`f.travel_order_id = $${paramIndex++}`);
    queryParams.push(params.travelOrderId);
  }
  if (params.status) {
    conditions.push(`f.status = $${paramIndex++}`);
    queryParams.push(params.status);
  }
  if (params.dateFrom) {
    conditions.push(`f.event_time >= $${paramIndex++}::timestamp`);
    queryParams.push(params.dateFrom);
  }
  if (params.dateTo) {
    conditions.push(`f.event_time <= $${paramIndex++}::timestamp`);
    queryParams.push(params.dateTo);
  }
  if (params.search) {
    const searchTerm = `%${params.search}%`;
    conditions.push(`(
      f.location ILIKE $${paramIndex} OR
      f.event ILIKE $${paramIndex} OR
      v.plate_number ILIKE $${paramIndex} OR
      d.full_name ILIKE $${paramIndex} OR
      t_o.to_number ILIKE $${paramIndex}
    )`);
    queryParams.push(searchTerm);
    paramIndex++;
  }

  const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  const allowedSortColumns = ['event_time', 'status', 'road_speed', 'trip_date', 'created_at'];
  const sortBy = allowedSortColumns.includes(params.sortBy || '') ? params.sortBy! : 'event_time';
  const sortOrder = params.sortOrder === 'asc' ? 'ASC' : 'DESC';

  const countResult = await pool.query<{ total: string }>(
    `SELECT COUNT(*) AS total
     FROM fleet_trip_history f
     LEFT JOIN vehicles v ON v.id = f.vehicle_id
     LEFT JOIN drivers d ON d.id = f.driver_id
     LEFT JOIN travel_orders t_o ON t_o.id = f.travel_order_id
     ${whereClause}`,
    queryParams,
  );
  const total = parseInt(countResult.rows[0]?.total || '0', 10);

  const dataResult = await pool.query(
    `SELECT
       f.*,
       v.plate_number,
       d.full_name AS driver_full_name,
       t_o.to_number AS travel_order_to_number
     FROM fleet_trip_history f
     LEFT JOIN vehicles v ON v.id = f.vehicle_id
     LEFT JOIN drivers d ON d.id = f.driver_id
     LEFT JOIN travel_orders t_o ON t_o.id = f.travel_order_id
     ${whereClause}
     ORDER BY f.${sortBy} ${sortOrder}
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    [...queryParams, pageSize, offset],
  );

  const data: FleetTripHistoryRow[] = dataResult.rows.map((row: any) => ({
    id: row.id,
    travel_order_id: row.travel_order_id,
    vehicle_id: row.vehicle_id,
    driver_id: row.driver_id,
    fleet_trip_id: row.fleet_trip_id,
    event_time: row.event_time,
    trip_date: row.trip_date,
    status: row.status,
    event: row.event,
    road_speed: row.road_speed != null ? Number(row.road_speed) : null,
    location: row.location,
    latitude: row.latitude != null ? Number(row.latitude) : null,
    longitude: row.longitude != null ? Number(row.longitude) : null,
    fuel: row.fuel != null ? Number(row.fuel) : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    plate_number: row.plate_number,
    driver_full_name: row.driver_full_name,
    travel_order_to_number: row.travel_order_to_number,
  }));

  return {
    success: true,
    data,
    total,
    page,
    pageSize,
  };
}

/**
 * Get a single fleet trip history record by ID.
 */
export async function getFleetTripHistoryById(
  id: string,
): Promise<FleetTripHistoryRow | null> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT
       f.*,
       v.plate_number,
       d.full_name AS driver_full_name,
       t_o.to_number AS travel_order_to_number
     FROM fleet_trip_history f
     LEFT JOIN vehicles v ON v.id = f.vehicle_id
     LEFT JOIN drivers d ON d.id = f.driver_id
     LEFT JOIN travel_orders t_o ON t_o.id = f.travel_order_id
     WHERE f.id = $1
     LIMIT 1`,
    [id],
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    id: row.id,
    travel_order_id: row.travel_order_id,
    vehicle_id: row.vehicle_id,
    driver_id: row.driver_id,
    fleet_trip_id: row.fleet_trip_id,
    event_time: row.event_time,
    trip_date: row.trip_date,
    status: row.status,
    event: row.event,
    road_speed: row.road_speed != null ? Number(row.road_speed) : null,
    location: row.location,
    latitude: row.latitude != null ? Number(row.latitude) : null,
    longitude: row.longitude != null ? Number(row.longitude) : null,
    fuel: row.fuel != null ? Number(row.fuel) : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    plate_number: row.plate_number,
    driver_full_name: row.driver_full_name,
    travel_order_to_number: row.travel_order_to_number,
  };
}