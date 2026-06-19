import express, { type Request, type Response, type Router as ExpressRouter } from 'express';
import type { ApiResponse } from '@car-tracker/shared';
import { getPool } from '../db/db.js';

const router: ExpressRouter = express.Router();

/** Maps actual DB columns to API response shape. */
interface TravelOrderRow {
  id: string;
  to_number: string;
  vehicle_id: string | null;
  driver_id: string | null;
  purpose_of_travel: string;
  destination_target: string;
  scheduled_departure: string;
  scheduled_arrival: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  origin_location: string | null;
  // New columns from migration 006 (may not exist yet on older DBs)
  department?: string | null;
  traveler_name?: string | null;
  request_vehicle?: boolean;
  request_driver?: boolean;
  notes?: string | null;
  // Migration 013: who approved/rejected
  approved_by?: string | null;
  // Migration 016: lat/long coordinates
  lat_long_origin?: string | null;
  lat_long_destination?: string | null;
  // Joined columns
  plate_number?: string;
  driver_name?: string;
  approver_name?: string | null;
}

/** API response shape sent to the frontend. */
interface TravelOrderResponse {
  id: string;
  toNumber: string;
  vehicleId: string | null;
  driverId: string | null;
  originLocation: string;
  destinationLocation: string;
  scheduledDepartureAt: string | null;
  scheduledArrivalAt: string | null;
  actualDepartureAt: string | null;
  actualArrivalAt: string | null;
  status: string;
  purpose: string | null;
  notes: string | null;
  department: string;
  travelerName: string;
  requestVehicle: boolean;
  requestDriver: boolean;
  plateNumber: string | null;
  driverName: string | null;
  approvedBy: string | null;
  approvedByName: string | null;
  createdAt: string;
  updatedAt: string;
  latLongOrigin?: string | null;
  latLongDestination?: string | null;
}

// GET /api/travel-orders/pending — Fetch PENDING orders where vehicle_id AND driver_id are NULL
router.get('/pending', async (_req: Request, res: Response) => {
  try {
    const pool = getPool();
    const result = await pool.query<TravelOrderRow>(`
      SELECT
        to_.*,
        v.plate_number,
        d.full_name AS driver_name,
        u.name AS approver_name
      FROM travel_orders to_
      LEFT JOIN vehicles v ON v.id = to_.vehicle_id
      LEFT JOIN drivers  d ON d.id = to_.driver_id
      LEFT JOIN users   u ON u.id = to_.approved_by
      WHERE to_.status = 'PENDING'
        AND to_.vehicle_id IS NULL
        AND to_.driver_id IS NULL
      ORDER BY to_.created_at DESC
    `);
    const data = result.rows.map(mapRow);
    res.json({ success: true, data, message: 'Pending travel orders retrieved successfully' });
  } catch (error) {
    console.error('GET /api/travel-orders/pending error:', (error as Error).message);
    res.status(500).json({ success: false, data: null, error: 'Database error' });
  }
});

// GET /api/travel-orders/approved — Fetch APPROVED orders
router.get('/approved', async (_req: Request, res: Response) => {
  try {
    const pool = getPool();
    const result = await pool.query<TravelOrderRow>(`
      SELECT
        to_.*,
        v.plate_number,
        d.full_name AS driver_name,
        u.name AS approver_name
      FROM travel_orders to_
      LEFT JOIN vehicles v ON v.id = to_.vehicle_id
      LEFT JOIN drivers  d ON d.id = to_.driver_id
      LEFT JOIN users   u ON u.id = to_.approved_by
      WHERE to_.status = 'APPROVED'
      ORDER BY to_.created_at DESC
    `);
    const data = result.rows.map(mapRow);
    res.json({ success: true, data, message: 'Approved travel orders retrieved successfully' });
  } catch (error) {
    console.error('GET /api/travel-orders/approved error:', (error as Error).message);
    res.status(500).json({ success: false, data: null, error: 'Database error' });
  }
});

// GET /api/travel-orders/for-approval — Fetch FOR_APPROVAL orders where vehicle_id AND driver_id are populated
router.get('/for-approval', async (_req: Request, res: Response) => {
  try {
    const pool = getPool();
    const result = await pool.query<TravelOrderRow>(`
      SELECT
        to_.*,
        v.plate_number,
        d.full_name AS driver_name,
        u.name AS approver_name
      FROM travel_orders to_
      LEFT JOIN vehicles v ON v.id = to_.vehicle_id
      LEFT JOIN drivers  d ON d.id = to_.driver_id
      LEFT JOIN users   u ON u.id = to_.approved_by
      WHERE to_.status = 'FOR_APPROVAL'
        AND to_.vehicle_id IS NOT NULL
        AND to_.driver_id IS NOT NULL
      ORDER BY to_.created_at DESC
    `);
    const data = result.rows.map(mapRow);
    res.json({ success: true, data, message: 'For-approval travel orders retrieved successfully' });
  } catch (error) {
    console.error('GET /api/travel-orders/for-approval error:', (error as Error).message);
    res.status(500).json({ success: false, data: null, error: 'Database error' });
  }
});

// GET /api/travel-orders/cancelled — Fetch CANCELLED orders
router.get('/cancelled', async (_req: Request, res: Response) => {
  try {
    const pool = getPool();
    const result = await pool.query<TravelOrderRow>(`
      SELECT
        to_.*,
        v.plate_number,
        d.full_name AS driver_name,
        u.name AS approver_name
      FROM travel_orders to_
      LEFT JOIN vehicles v ON v.id = to_.vehicle_id
      LEFT JOIN drivers  d ON d.id = to_.driver_id
      LEFT JOIN users   u ON u.id = to_.approved_by
      WHERE to_.status = 'CANCELLED'
      ORDER BY to_.created_at DESC
    `);
    const data = result.rows.map(mapRow);
    res.json({ success: true, data, message: 'Cancelled travel orders retrieved successfully' });
  } catch (error) {
    console.error('GET /api/travel-orders/cancelled error:', (error as Error).message);
    res.status(500).json({ success: false, data: null, error: 'Database error' });
  }
});

// GET /api/travel-orders/for-request — Fetch FOR_REQUEST orders
router.get('/for-request', async (_req: Request, res: Response) => {
  try {
    const pool = getPool();
    const result = await pool.query<TravelOrderRow>(`
      SELECT
        to_.*,
        v.plate_number,
        d.full_name AS driver_name,
        u.name AS approver_name
      FROM travel_orders to_
      LEFT JOIN vehicles v ON v.id = to_.vehicle_id
      LEFT JOIN drivers  d ON d.id = to_.driver_id
      LEFT JOIN users   u ON u.id = to_.approved_by
      WHERE to_.status = 'FOR_REQUEST'
      ORDER BY to_.created_at DESC
    `);
    const data = result.rows.map(mapRow);
    res.json({ success: true, data, message: 'For-request travel orders retrieved successfully' });
  } catch (error) {
    console.error('GET /api/travel-orders/for-request error:', (error as Error).message);
    res.status(500).json({ success: false, data: null, error: 'Database error' });
  }
});

// GET /api/travel-orders/scheduled — Fetch all scheduled (FOR_APPROVAL, APPROVED, ACTIVE) orders grouped by date
router.get('/scheduled', async (_req: Request, res: Response) => {
  try {
    const pool = getPool();
    const result = await pool.query<TravelOrderRow>(`
      SELECT
        to_.*,
        v.plate_number,
        d.full_name AS driver_name,
        u.name AS approver_name
      FROM travel_orders to_
      LEFT JOIN vehicles v ON v.id = to_.vehicle_id
      LEFT JOIN drivers  d ON d.id = to_.driver_id
      LEFT JOIN users   u ON u.id = to_.approved_by
      WHERE to_.status IN ('FOR_APPROVAL','APPROVED','ACTIVE')
        AND to_.scheduled_departure IS NOT NULL
      ORDER BY to_.scheduled_departure ASC
    `);
    const data = result.rows.map(mapRow);
    res.json({ success: true, data, message: 'Scheduled travel orders retrieved successfully' });
  } catch (error) {
    console.error('GET /api/travel-orders/scheduled error:', (error as Error).message);
    res.status(500).json({ success: false, data: null, error: 'Database error' });
  }
});

// PATCH /api/travel-orders/:id/assign — Assign a vehicle and driver to a travel order
router.patch('/:id/assign', async (req: Request, res: Response) => {
  const { vehicle_id, driver_id } = req.body;

  if (!vehicle_id || !driver_id) {
    res.status(400).json({
      success: false,
      data: null,
      error: 'Both vehicle_id and driver_id are required',
    });
    return;
  }

  try {
    const pool = getPool();

    // Validate that the vehicle exists and has one of the allowed tracking plates
    const VALID_PLATES = ['KAR6444', 'KAR6412', 'KAR6558'];
    const vehicleResult = await pool.query(
      'SELECT id, plate_number FROM vehicles WHERE id = $1',
      [vehicle_id],
    );

    if (vehicleResult.rows.length === 0) {
      res.status(404).json({
        success: false,
        data: null,
        error: 'Vehicle not found',
      });
      return;
    }

    const vehicle = vehicleResult.rows[0];
    if (!VALID_PLATES.includes(vehicle.plate_number)) {
      res.status(400).json({
        success: false,
        data: null,
        error: `Vehicle plate "${vehicle.plate_number}" is not a valid tracking plate. Allowed plates: ${VALID_PLATES.join(', ')}`,
      });
      return;
    }

    // Validate that the driver exists
    const driverResult = await pool.query(
      'SELECT id FROM drivers WHERE id = $1',
      [driver_id],
    );

    if (driverResult.rows.length === 0) {
      res.status(404).json({
        success: false,
        data: null,
        error: 'Driver not found',
      });
      return;
    }

    // Update the travel order with the assigned vehicle and driver,
    // and automatically transition status to FOR_APPROVAL
    const updateResult = await pool.query<TravelOrderRow>(
      `UPDATE travel_orders
       SET vehicle_id = $1, driver_id = $2, status = 'FOR_APPROVAL', updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [vehicle_id, driver_id, req.params.id],
    );

    if (updateResult.rows.length === 0) {
      res.status(404).json({
        success: false,
        data: null,
        error: 'Travel order not found',
      });
      return;
    }

    // Fetch the updated row with joined vehicle & driver info
    const fullResult = await pool.query<TravelOrderRow>(`
      SELECT
        to_.*,
        v.plate_number,
        d.full_name AS driver_name,
        u.name AS approver_name
      FROM travel_orders to_
      LEFT JOIN vehicles v ON v.id = to_.vehicle_id
      LEFT JOIN drivers  d ON d.id = to_.driver_id
      LEFT JOIN users   u ON u.id = to_.approved_by
      WHERE to_.id = $1
    `, [req.params.id]);

    res.json({
      success: true,
      data: mapRow(fullResult.rows[0]),
      message: 'Travel order assigned successfully',
    });
  } catch (error) {
    console.error('PATCH /api/travel-orders/:id/assign error:', (error as Error).message);
    res.status(500).json({ success: false, data: null, error: 'Database error' });
  }
});

// GET /api/travel-orders — List all with left-joined vehicle & driver
router.get('/', async (_req: Request, res: Response) => {
  try {
    const pool = getPool();
    const result = await pool.query<TravelOrderRow>(`
      SELECT
        to_.*,
        v.plate_number,
        d.full_name AS driver_name,
        u.name AS approver_name
      FROM travel_orders to_
      LEFT JOIN vehicles v ON v.id = to_.vehicle_id
      LEFT JOIN drivers  d ON d.id = to_.driver_id
      LEFT JOIN users   u ON u.id = to_.approved_by
      ORDER BY to_.created_at DESC
    `);
    const data = result.rows.map(mapRow);
    res.json({ success: true, data, message: 'Travel orders retrieved successfully' });
  } catch (error) {
    console.error('GET /api/travel-orders error:', (error as Error).message);
    res.status(500).json({ success: false, data: null, error: 'Database error' });
  }
});

// GET /api/travel-orders/next-number — Get the next available TO number for the current year
router.get('/next-number', async (_req: Request, res: Response) => {
  try {
    const pool = getPool();
    const year = new Date().getFullYear();
    // Find the highest sequence number for TO numbers in the current year
    const result = await pool.query<{ max_seq: number | null }>(
      `SELECT MAX(CAST(SPLIT_PART(to_number, '-', 3) AS INTEGER)) AS max_seq
       FROM travel_orders
       WHERE to_number LIKE $1`,
      [`TO-${year}-%`],
    );
    const nextSeq = (result.rows[0]?.max_seq ?? 0) + 1;
    res.json({ success: true, data: nextSeq, message: 'Next TO number retrieved' });
  } catch (error) {
    console.error('GET /api/travel-orders/next-number error:', (error as Error).message);
    res.status(500).json({ success: false, data: null, error: 'Database error' });
  }
});

// GET /api/travel-orders/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const result = await pool.query<TravelOrderRow>(`
      SELECT
        to_.*,
        v.plate_number,
        d.full_name AS driver_name,
        u.name AS approver_name
      FROM travel_orders to_
      LEFT JOIN vehicles v ON v.id = to_.vehicle_id
      LEFT JOIN drivers  d ON d.id = to_.driver_id
      LEFT JOIN users   u ON u.id = to_.approved_by
      WHERE to_.id = $1
    `, [req.params.id]);
    if (result.rows.length === 0) {
      res.status(404).json({ success: false, data: null, error: 'Travel order not found' });
      return;
    }
    res.json({ success: true, data: mapRow(result.rows[0]) });
  } catch (error) {
    console.error('GET /api/travel-orders/:id error:', (error as Error).message);
    res.status(500).json({ success: false, data: null, error: 'Database error' });
  }
});

// POST /api/travel-orders — Create a new travel order
router.post('/', async (req: Request, res: Response) => {
  const {
    vehicleId, driverId, originLocation, destinationLocation,
    scheduledDepartureAt, scheduledArrivalAt, purpose, notes,
    department, travelerName, requestVehicle, requestDriver,
    toNumber,
    latLongOrigin, latLongDestination,
  } = req.body;

  if (!destinationLocation) {
    res.status(400).json({
      success: false,
      data: null,
      error: 'Destination is required',
    });
    return;
  }

  if (!toNumber) {
    res.status(400).json({
      success: false,
      data: null,
      error: 'TO Number is required',
    });
    return;
  }

  try {
    const pool = getPool();
    const result = await pool.query<TravelOrderRow>(`
      INSERT INTO travel_orders
        (to_number, vehicle_id, driver_id, origin_location, destination_target,
         scheduled_departure, scheduled_arrival, purpose_of_travel, notes,
         department, traveler_name, request_vehicle, request_driver,
         lat_long_origin, lat_long_destination)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING *
    `, [
      toNumber,
      vehicleId || null, driverId || null, originLocation || '', destinationLocation,
      scheduledDepartureAt, scheduledArrivalAt || null,
      purpose || '', notes || '',
      department || '', travelerName || '',
      requestVehicle ?? false, requestDriver ?? false,
      latLongOrigin || null, latLongDestination || null,
    ]);

    res.status(201).json({
      success: true,
      data: mapRow(result.rows[0]),
      message: 'Travel order created successfully',
    });
  } catch (error) {
    console.error('POST /api/travel-orders error:', (error as Error).message);
    res.status(500).json({ success: false, data: null, error: 'Database error' });
  }
});

// DELETE /api/travel-orders/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const result = await pool.query(
      'DELETE FROM travel_orders WHERE id = $1 RETURNING id',
      [req.params.id],
    );
    if (result.rows.length === 0) {
      res.status(404).json({ success: false, data: null, error: 'Travel order not found' });
      return;
    }
    res.json({ success: true, data: null, message: 'Travel order deleted successfully' });
  } catch (error) {
    console.error('DELETE /api/travel-orders/:id error:', (error as Error).message);
    res.status(500).json({ success: false, data: null, error: 'Database error' });
  }
});

// PATCH /api/travel-orders/:id — Update a travel order (e.g. status, fields)
router.patch('/:id', async (req: Request, res: Response) => {
  // Map camelCase API field names to snake_case DB column names
  const fieldMap: Record<string, string> = {
    status: 'status',
    approvedBy: 'approved_by',
    notes: 'notes',
    originLocation: 'origin_location',
    destinationLocation: 'destination_target',
    scheduledDepartureAt: 'scheduled_departure',
    scheduledArrivalAt: 'scheduled_arrival',
    purpose: 'purpose_of_travel',
    department: 'department',
    travelerName: 'traveler_name',
    requestVehicle: 'request_vehicle',
    requestDriver: 'request_driver',
    latLongOrigin: 'lat_long_origin',
    latLongDestination: 'lat_long_destination',
  };
  const allowedFields = Object.keys(fieldMap);
  const updates: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      updates.push(`${fieldMap[field]} = $${idx++}`);
      values.push(req.body[field]);
    }
  }

  if (updates.length === 0) {
    res.status(400).json({ success: false, data: null, error: 'No valid fields to update' });
    return;
  }

  try {
    const pool = getPool();
    values.push(req.params.id);
    const result = await pool.query<TravelOrderRow>(
      `UPDATE travel_orders SET ${updates.join(', ')} WHERE id = $${idx}
       RETURNING *`,
      values,
    );
    if (result.rows.length === 0) {
      res.status(404).json({ success: false, data: null, error: 'Travel order not found' });
      return;
    }
    res.json({ success: true, data: mapRow(result.rows[0]), message: 'Travel order updated' });
  } catch (error) {
    console.error('PATCH /api/travel-orders/:id error:', (error as Error).message);
    res.status(500).json({ success: false, data: null, error: 'Database error' });
  }
});

function mapRow(row: TravelOrderRow): TravelOrderResponse {
  return {
    id: row.id,
    toNumber: row.to_number,
    vehicleId: row.vehicle_id,
    driverId: row.driver_id,
    originLocation: row.origin_location ?? '',
    destinationLocation: row.destination_target,
    scheduledDepartureAt: row.scheduled_departure ?? null,
    scheduledArrivalAt: row.scheduled_arrival ?? null,
    actualDepartureAt: null,
    actualArrivalAt: null,
    status: row.status,
    purpose: row.purpose_of_travel,
    notes: row.notes ?? null,
    department: row.department ?? '',
    travelerName: row.traveler_name ?? '',
    requestVehicle: row.request_vehicle ?? false,
    requestDriver: row.request_driver ?? false,
    plateNumber: row.plate_number ?? null,
    driverName: row.driver_name ?? null,
    approvedBy: row.approved_by ?? null,
    approvedByName: row.approver_name ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    latLongOrigin: row.lat_long_origin ?? null,
    latLongDestination: row.lat_long_destination ?? null,
  };
}

export default router;
