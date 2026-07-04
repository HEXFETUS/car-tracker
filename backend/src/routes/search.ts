import express, { type Request, type Response, type Router as ExpressRouter } from 'express';
import { getPool } from '../db/db.js';

const router: ExpressRouter = express.Router();

// GET /api/search?q= — Global search across vehicles, drivers, travel orders, GPS telemetry
router.get('/', async (req: Request, res: Response) => {
  try {
    const q = String(req.query.q || '').trim();
    console.log('[search] query', q);

    if (!q) {
      res.json({ success: true, data: [], message: 'No query provided' });
      return;
    }

    const pool = getPool();
    const searchPattern = `%${q}%`;

    // Search vehicles — includes plate_number, make, model
    const vehiclesPromise = pool.query(`
      SELECT
        id,
        plate_number,
        make,
        model
      FROM vehicles
      WHERE
        plate_number ILIKE $1
        OR make ILIKE $1
        OR model ILIKE $1
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

    // Search GPS telemetry — latest record per plate_number (directly on gps_telemetry)
    const gpsTelemetryPromise = pool.query(`
      SELECT DISTINCT ON (plate_number)
        vehicle_id,
        plate_number,
        location_name,
        speed_kmh,
        ignition,
        recorded_at
      FROM gps_telemetry
      WHERE plate_number ILIKE '%' || $1 || '%'
      ORDER BY plate_number, recorded_at DESC
      LIMIT 5
    `, [q]);

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
        title: row.plate_number,
        subtitle: subtitle || 'Vehicle',
        dbId: row.id,
        vehicle_id: row.id,
        plate_number: row.plate_number,
        plateNumber: row.plate_number,
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
        title: row.plate_number,
        subtitle: `GPS · ${loc}${speed}`,
        dbId: row.vehicle_id,
        vehicle_id: row.vehicle_id,
        plate_number: row.plate_number,
        plateNumber: row.plate_number,
        speedKmh: row.speed_kmh,
        ignition: row.ignition,
        recordedAt: row.recorded_at,
        locationName: row.location_name,
      });
    }

    console.log('[search] results', results.length);
    res.json({ success: true, data: results.slice(0, 15), message: 'Search results retrieved' });
  } catch (error) {
    console.error('GET /api/search error:', error instanceof Error ? error.message : String(error));
    res.status(500).json({ success: false, data: null, error: 'Search query failed' });
  }
});

export default router;