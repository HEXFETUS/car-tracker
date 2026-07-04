import express, { type Request, type Response, type Router as ExpressRouter } from 'express';
import { getPool } from '../db/db.js';

const router: ExpressRouter = express.Router();

// GET /api/vehicles/:id/detail — Vehicle detail for the dashboard drawer
// Supports both vehicle UUID and plate_number lookup
router.get('/:id/detail', async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const identifier = req.params.id;

    // Try to find the vehicle by id or plate_number
    const vehicleResult = await pool.query(`
      SELECT
        id,
        plate_number,
        make,
        model,
        year,
        vehicle_type
      FROM vehicles
      WHERE id = $1 OR plate_number = $1
      LIMIT 1
    `, [identifier]);

    const vehicleRow = vehicleResult.rows[0] || null;

    // Get latest telemetry for this vehicle (by vehicle_id or plate_number)
    const telemetryResult = await pool.query(`
      SELECT
        vehicle_id,
        plate_number,
        location_name,
        speed_kmh,
        fuel_liters,
        ignition,
        recorded_at,
        latitude,
        longitude
      FROM gps_telemetry
      WHERE vehicle_id = $1 OR plate_number = $1
      ORDER BY recorded_at DESC, created_at DESC
      LIMIT 1
    `, [identifier]);

    const telemetryRow = telemetryResult.rows[0] || null;

    // Get active travel order for this vehicle
    let activeTo = null;
    if (vehicleRow) {
      const toResult = await pool.query(`
        SELECT
          to_.id,
          to_.to_number,
          to_.origin_location,
          to_.destination_target,
          to_.status,
          to_.trip_type,
          d.id AS driver_id,
          d.full_name AS driver_name,
          d.phone AS driver_phone
        FROM travel_orders to_
        LEFT JOIN drivers d ON d.id = to_.driver_id
        WHERE to_.vehicle_id = $1
          AND to_.status IN ('ACTIVE', 'APPROVED')
        ORDER BY to_.created_at DESC
        LIMIT 1
      `, [vehicleRow.id]);
      activeTo = toResult.rows[0] || null;
    }

    // Get latest trip log for distance/max speed
    let tripLog = null;
    const vehicleId = vehicleRow?.id || telemetryRow?.vehicle_id;
    if (vehicleId) {
      const tripResult = await pool.query(`
        SELECT
          gps_distance_km,
          max_speed_kph,
          trip_status_gps,
          departure_time_gps,
          arrival_time_gps
        FROM gps_trip_logs
        WHERE vehicle_id = $1
        ORDER BY COALESCE(trip_date, created_at) DESC
        LIMIT 1
      `, [vehicleId]);
      tripLog = tripResult.rows[0] || null;
    }

    const plateNumber = vehicleRow?.plate_number || telemetryRow?.plate_number || identifier;

    const data = {
      id: vehicleRow?.id || telemetryRow?.vehicle_id || identifier,
      plateNumber: plateNumber,
      make: vehicleRow?.make || null,
      model: vehicleRow?.model || null,
      year: vehicleRow?.year || null,
      vehicleType: vehicleRow?.vehicle_type || null,
      gpsNumber: '—',
      underRepair: false,
      driverId: activeTo?.driver_id || null,
      driverName: activeTo?.driver_name || 'Unassigned',
      driverPhone: activeTo?.driver_phone || null,
      travelOrderId: activeTo?.id || null,
      toNumber: activeTo?.to_number || '—',
      origin: activeTo?.origin_location || '—',
      destination: activeTo?.destination_target || '—',
      travelOrderStatus: activeTo?.status || null,
      tripType: activeTo?.trip_type || '—',
      currentSpeed: telemetryRow?.speed_kmh != null ? Number(telemetryRow.speed_kmh) : 0,
      ignition: telemetryRow?.ignition === true,
      lastUpdated: telemetryRow?.recorded_at || null,
      locationName: telemetryRow?.location_name || null,
      latitude: telemetryRow?.latitude != null ? Number(telemetryRow.latitude) : null,
      longitude: telemetryRow?.longitude != null ? Number(telemetryRow.longitude) : null,
      fuelLevel: telemetryRow?.fuel_liters != null ? Number(telemetryRow.fuel_liters) : null,
      distance: tripLog?.gps_distance_km != null ? Number(tripLog.gps_distance_km) : 0,
      maxSpeed: tripLog?.max_speed_kph != null ? Number(tripLog.max_speed_kph) : 0,
      tripStatus: tripLog?.trip_status_gps || '—',
      departureTime: tripLog?.departure_time_gps || null,
      arrivalTime: tripLog?.arrival_time_gps || null,
    };

    res.json({ success: true, data, message: 'Vehicle detail retrieved' });
  } catch (error) {
    console.error('GET /api/vehicles/:id/detail error:', error instanceof Error ? error.message : String(error));
    res.status(500).json({ success: false, data: null, error: 'Vehicle detail query failed' });
  }
});

export default router;