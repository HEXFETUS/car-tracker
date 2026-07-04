import express, { type Request, type Response, type Router as ExpressRouter } from 'express';
import { getPool } from '../db/db.js';

const router: ExpressRouter = express.Router();

// GET /api/search?q= — Global search across vehicles, drivers, travel orders, GPS telemetry
router.get('/', async (req: Request, res: Response) => {
  try {
    const q = (req.query.q as string || '').trim();
    if (!q) {
      res.json({ success: true, data: [], message: 'No query provided' });
      return;
    }

    const pool = getPool();
    const searchPattern = `%${q}%`;

    // Search vehicles
    const vehiclesPromise = pool.query(`
      SELECT
        id,
        plate_number,
        make,
        model,
        gps_number
      FROM vehicles
      WHERE
        plate_number ILIKE $1
        OR make ILIKE $1
        OR model ILIKE $1
        OR gps_number ILIKE $1
      LIMIT 5
    `, [searchPattern]);

    // Search drivers — with assigned vehicle info
    const driversPromise = pool.query(`
      SELECT
        d.id,
        d.full_name,
        d.phone,
        d.status,
        v.plate_number AS assigned_vehicle_plate,
        v.make AS assigned_vehicle_make,
        v.model AS assigned_vehicle_model
      FROM drivers d
      LEFT JOIN LATERAL (
        SELECT v2.plate_number, v2.make, v2.model
        FROM travel_orders to_
        JOIN vehicles v2 ON v2.id = to_.vehicle_id
        WHERE to_.driver_id = d.id
          AND to_.status IN ('ACTIVE', 'APPROVED')
        ORDER BY to_.created_at DESC
        LIMIT 1
      ) v ON TRUE
      WHERE
        d.full_name ILIKE $1
        OR d.phone ILIKE $1
      LIMIT 5
    `, [searchPattern]);

    // Search travel orders
    const travelOrdersPromise = pool.query(`
      SELECT
        to_.id,
        to_.to_number,
        to_.status,
        v.plate_number AS vehicle_plate,
        d.full_name AS driver_name,
        to_.origin_location,
        to_.destination_target
      FROM travel_orders to_
      LEFT JOIN vehicles v ON v.id = to_.vehicle_id
      LEFT JOIN drivers d ON d.id = to_.driver_id
      WHERE
        to_.to_number ILIKE $1
        OR v.plate_number ILIKE $1
        OR d.full_name ILIKE $1
        OR to_.destination_target ILIKE $1
        OR to_.origin_location ILIKE $1
      LIMIT 5
    `, [searchPattern]);

    // Search GPS telemetry — latest location per vehicle
    const gpsTelemetryPromise = pool.query(`
      WITH latest_telemetry AS (
        SELECT DISTINCT ON (vehicle_id)
          vehicle_id,
          speed_kmh,
          ignition,
          recorded_at,
          location_name,
          latitude,
          longitude,
          fuel_liters
        FROM gps_telemetry
        ORDER BY vehicle_id, recorded_at DESC
      )
      SELECT
        lt.vehicle_id,
        v.plate_number,
        lt.speed_kmh,
        lt.ignition,
        lt.recorded_at,
        lt.location_name,
        lt.latitude,
        lt.longitude,
        lt.fuel_liters,
        v.gps_number
      FROM latest_telemetry lt
      JOIN vehicles v ON v.id = lt.vehicle_id
      WHERE
        v.plate_number ILIKE $1
        OR v.gps_number ILIKE $1
        OR lt.location_name ILIKE $1
      LIMIT 5
    `, [searchPattern]);

    const [vehiclesResult, driversResult, travelOrdersResult, gpsTelemetryResult] = await Promise.all([
      vehiclesPromise,
      driversPromise,
      travelOrdersPromise,
      gpsTelemetryPromise,
    ]);

    // Build unified search results
    const results: any[] = [];

    for (const row of vehiclesResult.rows) {
      const subtitle = [row.make, row.model].filter(Boolean).join(' ');
      results.push({
        id: `v-${row.id}`,
        type: 'vehicle',
        label: row.plate_number,
        subtitle: subtitle || 'Vehicle',
        dbId: row.id,
        plateNumber: row.plate_number,
        gpsNumber: row.gps_number,
      });
    }

    for (const row of driversResult.rows) {
      const assigned = row.assigned_vehicle_plate
        ? `${row.assigned_vehicle_plate} · ${[row.assigned_vehicle_make, row.assigned_vehicle_model].filter(Boolean).join(' ')}`
        : 'No assigned vehicle';
      results.push({
        id: `d-${row.id}`,
        type: 'driver',
        label: row.full_name,
        subtitle: assigned,
        dbId: row.id,
        driverName: row.full_name,
        phone: row.phone,
        status: row.status,
      });
    }

    for (const row of travelOrdersResult.rows) {
      const route = [row.origin_location, row.destination_target].filter(Boolean).join(' → ');
      const info = [row.vehicle_plate, row.driver_name].filter(Boolean).join(' · ');
      results.push({
        id: `to-${row.id}`,
        type: 'travel-order',
        label: row.to_number,
        subtitle: `${info}${route ? ` · ${route}` : ''}`,
        dbId: row.id,
        toNumber: row.to_number,
        status: row.status,
      });
    }

    for (const row of gpsTelemetryResult.rows) {
      const loc = row.location_name || 'No location';
      const speed = row.speed_kmh != null ? ` · ${Number(row.speed_kmh).toFixed(0)} km/h` : '';
      results.push({
        id: `gps-${row.vehicle_id}`,
        type: 'gps',
        label: row.plate_number,
        subtitle: `GPS #${row.gps_number || '—'} · ${loc}${speed}`,
        dbId: row.vehicle_id,
        plateNumber: row.plate_number,
        gpsNumber: row.gps_number,
        latitude: row.latitude,
        longitude: row.longitude,
        speedKmh: row.speed_kmh,
        ignition: row.ignition,
        recordedAt: row.recorded_at,
        locationName: row.location_name,
        fuelLiters: row.fuel_liters,
      });
    }

    res.json({ success: true, data: results.slice(0, 15), message: 'Search results retrieved' });
  } catch (error) {
    console.error('GET /api/search error:', error instanceof Error ? error.message : String(error));
    res.status(500).json({ success: false, data: null, error: 'Search query failed' });
  }
});

export default router;