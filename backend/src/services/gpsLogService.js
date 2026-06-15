// ── GPS Trip Log Service ──────────────────────────────────────
//
// Database persistence layer for automated GPS trip log ingestion.
// Called by the cron sync pipeline after each fleet telemetry cycle.
import { getPool } from '../db/db.js';
// ── Relational Lookups ─────────────────────────────────────────
/**
 * Find a vehicle record by its plate number (case-insensitive).
 * Returns the vehicle UUID or null if not found.
 */
export async function findVehicleByPlate(plateNumber) {
    const pool = getPool();
    const result = await pool.query(`SELECT id FROM vehicles WHERE UPPER(plate_number) = UPPER($1) LIMIT 1`, [plateNumber]);
    return result.rows[0]?.id ?? null;
}
/**
 * Find an active/approved travel order assigned to the given vehicle.
 * Returns the travel order record or null.
 */
export async function findActiveTravelOrder(vehicleId) {
    const pool = getPool();
    const result = await pool.query(`SELECT id, status, driver_id
       FROM travel_orders
      WHERE vehicle_id = $1
        AND UPPER(status) = 'ACTIVE'
      ORDER BY created_at DESC
      LIMIT 1`, [vehicleId]);
    return result.rows[0] ?? null;
}
/**
 * Find a travel order that is APPROVED, ACTIVE, or COMPLETED for a
 * specific vehicle on a specific date. The date check uses the
 * scheduled_departure and scheduled_arrival range.
 *
 * Returns the matched travel order record or null if no valid
 * travel order exists for that vehicle on that date.
 */
export async function findApprovedTravelOrderForDate(vehicleId, dateStr) {
    const pool = getPool();
    const result = await pool.query(`SELECT id, vehicle_id, driver_id, status
       FROM travel_orders
      WHERE vehicle_id = $1
        AND status IN ('APPROVED', 'ACTIVE', 'COMPLETED')
        AND $2::date BETWEEN scheduled_departure::date AND COALESCE(scheduled_arrival::date, $2::date)
      ORDER BY created_at DESC
      LIMIT 1`, [vehicleId, dateStr]);
    return result.rows[0] ?? null;
}
/**
 * Find a driver by their full name (case-insensitive, partial match).
 * Returns the driver UUID or null if not found.
 */
export async function findDriverByName(driverName) {
    const pool = getPool();
    const result = await pool.query(`SELECT id FROM drivers
      WHERE UPPER(full_name) = UPPER($1)
      LIMIT 1`, [driverName]);
    return result.rows[0]?.id ?? null;
}
// ── GPS Trip Log Persistence ───────────────────────────────────
/**
 * Insert a single GPS trip log record into the database.
 * Returns the inserted row or throws on failure.
 */
export async function saveGpsTripLog(logData) {
    const pool = getPool();
    const result = await pool.query(`INSERT INTO gps_trip_logs
       (gps_record_no, trip_date, vehicle_id, driver_id,
        origin_gps_start_point, destination_gps_end_point,
        actual_route_road_taken, departure_time_gps, arrival_time_gps,
        gps_distance_km, engine_hours, max_speed_kph,
        trip_status_gps, travel_order_id, to_status_auto,
        anomaly_flag, notes_remarks)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
     ON CONFLICT (gps_record_no) DO UPDATE SET
        gps_distance_km     = EXCLUDED.gps_distance_km,
        max_speed_kph       = EXCLUDED.max_speed_kph,
        engine_hours        = EXCLUDED.engine_hours,
        arrival_time_gps    = EXCLUDED.arrival_time_gps,
        trip_status_gps     = EXCLUDED.trip_status_gps,
        anomaly_flag        = EXCLUDED.anomaly_flag,
        notes_remarks       = EXCLUDED.notes_remarks
     RETURNING id`, [
        logData.gpsRecordNo,
        logData.tripDate,
        logData.vehicleId,
        logData.driverId,
        logData.originGpsStartPoint,
        logData.destinationGpsEndPoint,
        logData.actualRouteRoadTaken,
        logData.departureTimeGps,
        logData.arrivalTimeGps,
        logData.gpsDistanceKm,
        logData.engineHours,
        logData.maxSpeedKph,
        logData.tripStatusGps,
        logData.travelOrderId,
        logData.toStatusAuto,
        logData.anomalyFlag,
        logData.notesRemarks,
    ]);
    return result.rows[0];
}
/**
 * Resolve all relational IDs for a GPS log entry.
 * Runs vehicle lookup, travel order lookup, and driver lookup in parallel.
 */
export async function resolveGpsLogRelations(params) {
    const { plateNumber, driverName } = params;
    // Step 1: Find the vehicle by plate number
    const vehicleId = await findVehicleByPlate(plateNumber);
    if (!vehicleId) {
        return { vehicleId: null, travelOrderId: null, toStatusAuto: null, driverId: null };
    }
    // Step 2: Find active travel order and driver in parallel
    const [travelOrder, directDriverId] = await Promise.all([
        findActiveTravelOrder(vehicleId),
        driverName ? findDriverByName(driverName) : Promise.resolve(null),
    ]);
    // Step 3: If a travel order exists, use its driver; otherwise use the directly matched driver
    const driverId = travelOrder?.driver_id ?? directDriverId ?? null;
    const travelOrderId = travelOrder?.id ?? null;
    const toStatusAuto = travelOrder?.status ?? null;
    return { vehicleId, travelOrderId, toStatusAuto, driverId };
}
//# sourceMappingURL=gpsLogService.js.map