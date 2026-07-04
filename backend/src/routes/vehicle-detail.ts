import express, { type Request, type Response, type Router as ExpressRouter } from 'express';
import { getPool } from '../db/db.js';

const router: ExpressRouter = express.Router();

// GET /api/vehicles/:id/detail — Rich vehicle detail for the dashboard drawer
router.get('/:id/detail', async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const vehicleId = req.params.id;

    const result = await pool.query(`
      SELECT
        v.id,
        v.plate_number,
        v.make,
        v.model,
        v.year,
        v.vehicle_type,
        v.gps_number,
        v.under_repair,
        d.id AS driver_id,
        d.full_name AS driver_name,
        d.phone AS driver_phone,
        to_.id AS travel_order_id,
        to_.to_number,
        to_.origin_location,
        to_.destination_target,
        to_.status AS travel_order_status,
        to_.trip_type,
        lt.speed_kmh,
        lt.ignition,
        lt.recorded_at,
        lt.location_name,
        lt.latitude,
        lt.longitude,
        lt.fuel_liters,
        gtl.gps_distance_km,
        gtl.max_speed_kph,
        gtl.trip_status_gps,
        gtl.departure_time_gps,
        gtl.arrival_time_gps
      FROM vehicles v
      LEFT JOIN LATERAL (
        SELECT to_.id, to_.to_number, to_.origin_location, to_.destination_target,
               to_.status, to_.trip_type, to_.driver_id, to_.vehicle_id
        FROM travel_orders to_
        WHERE to_.vehicle_id = v.id
          AND to_.status IN ('ACTIVE', 'APPROVED')
        ORDER BY to_.created_at DESC
        LIMIT 1
      ) to_ ON TRUE
      LEFT JOIN drivers d ON d.id = to_.driver_id
      LEFT JOIN LATERAL (
        SELECT speed_kmh, ignition, recorded_at, location_name, latitude, longitude, fuel_liters
        FROM gps_telemetry
        WHERE vehicle_id = v.id
        ORDER BY COALESCE(recorded_at, created_at) DESC
        LIMIT 1
      ) lt ON TRUE
      LEFT JOIN LATERAL (
        SELECT gps_distance_km, max_speed_kph, trip_status_gps, departure_time_gps, arrival_time_gps
        FROM gps_trip_logs
        WHERE vehicle_id = v.id
        ORDER BY COALESCE(trip_date, created_at) DESC
        LIMIT 1
      ) gtl ON TRUE
      WHERE v.id = $1
    `, [vehicleId]);

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, data: null, error: 'Vehicle not found' });
      return;
    }

    const row = result.rows[0];

    const data = {
      id: row.id,
      plateNumber: row.plate_number,
      make: row.make,
      model: row.model,
      year: row.year,
      vehicleType: row.vehicle_type,
      gpsNumber: row.gps_number || '—',
      underRepair: row.under_repair,
      driverId: row.driver_id || null,
      driverName: row.driver_name || 'Unassigned',
      driverPhone: row.driver_phone || null,
      travelOrderId: row.travel_order_id || null,
      toNumber: row.to_number || '—',
      origin: row.origin_location || '—',
      destination: row.destination_target || '—',
      travelOrderStatus: row.travel_order_status || null,
      tripType: row.trip_type || '—',
      currentSpeed: row.speed_kmh != null ? Number(row.speed_kmh) : 0,
      ignition: row.ignition === true,
      lastUpdated: row.recorded_at || null,
      locationName: row.location_name || null,
      latitude: row.latitude != null ? Number(row.latitude) : null,
      longitude: row.longitude != null ? Number(row.longitude) : null,
      fuelLevel: row.fuel_liters != null ? Number(row.fuel_liters) : null,
      distance: row.gps_distance_km != null ? Number(row.gps_distance_km) : 0,
      maxSpeed: row.max_speed_kph != null ? Number(row.max_speed_kph) : 0,
      tripStatus: row.trip_status_gps || '—',
      departureTime: row.departure_time_gps || null,
      arrivalTime: row.arrival_time_gps || null,
    };

    res.json({ success: true, data, message: 'Vehicle detail retrieved' });
  } catch (error) {
    console.error('GET /api/vehicles/:id/detail error:', error instanceof Error ? error.message : String(error));
    res.status(500).json({ success: false, data: null, error: 'Vehicle detail query failed' });
  }
});

export default router;