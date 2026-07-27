import express, { type Request, type Response, type Router as ExpressRouter } from 'express';
import { getPool } from '../db/db.js';
import { validateUuidParam } from '../middleware/validate-uuid.js';

const router: ExpressRouter = express.Router();
router.param('id', validateUuidParam);

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
        model
      FROM vehicles
      WHERE id::text = $1::text OR plate_number = $1
      LIMIT 1
    `, [identifier]);

    const vehicleRow = vehicleResult.rows[0] || null;

    // Get latest telemetry for this vehicle (by vehicle_id)
    let telemetryRow = null;
    const vehicleId = vehicleRow?.id || identifier;
    if (vehicleId) {
      try {
        const telemetryResult = await pool.query(`
          SELECT
            speed_kmh,
            fuel_liters,
            ignition,
            recorded_at,
            location_name
          FROM gps_telemetry
          WHERE vehicle_id::text = $1::text
          ORDER BY recorded_at DESC, created_at DESC
          LIMIT 1
        `, [vehicleId]);
        telemetryRow = telemetryResult.rows[0] || null;
      } catch (error) {
        console.error('[vehicle-detail] latest telemetry query failed', error);
        throw error;
      }
    }

    // Get active travel order for this vehicle
    let activeTo = null;
    if (vehicleRow) {
      try {
        const toResult = await pool.query(`
          SELECT
            to_number,
            status,
            driver_id,
            origin_location,
            destination_target AS destination_location
          FROM travel_orders
          WHERE vehicle_id::text = $1::text
            AND status IN ('APPROVED', 'ACTIVE')
          ORDER BY created_at DESC
          LIMIT 1
        `, [vehicleRow.id]);
        activeTo = toResult.rows[0] || null;
      } catch (error) {
        console.error('[vehicle-detail] active TO query failed', error);
        throw error;
      }
    }

    // Get driver name if there is an active travel order with a driver
    let driverName: string | null = null;
    if (activeTo?.driver_id) {
      try {
        const driverResult = await pool.query(`
          SELECT full_name
          FROM drivers
          WHERE id::text = $1::text
          LIMIT 1
        `, [activeTo.driver_id]);
        driverName = driverResult.rows[0]?.full_name || null;
      } catch (error) {
        console.error('[vehicle-detail] driver query failed', error);
        throw error;
      }
    }

    const plateNumber = vehicleRow?.plate_number || identifier;

    // Determine status from active travel order if available
    const status = activeTo?.status || (telemetryRow ? 'active' : null);

    const data = {
      id: vehicleRow?.id || identifier,
      plateNumber,
      model: vehicleRow?.model || null,
      driverName: driverName || 'Unassigned',
      toNumber: activeTo?.to_number || null,
      status,
      speedKmh: telemetryRow?.speed_kmh != null ? Number(telemetryRow.speed_kmh) : null,
      fuelLiters: telemetryRow?.fuel_liters != null ? Number(telemetryRow.fuel_liters) : null,
      ignition: telemetryRow?.ignition === true,
      locationName: telemetryRow?.location_name || null,
      lastSeen: telemetryRow?.recorded_at || null,
    };

    res.json({ success: true, data, message: 'Vehicle detail retrieved' });
  } catch (error) {
    console.error('GET /api/vehicles/:id/detail error:', error instanceof Error ? error.message : String(error));
    res.status(500).json({ success: false, data: null, error: 'Vehicle detail query failed' });
  }
});

export default router;
