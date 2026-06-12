import { Router, Request, Response } from 'express';
import type { ApiResponse } from '@car-tracker/shared';
import { getPool } from '../db/db.js';

const router: Router = Router();

/** Maps actual DB columns to API response shape. */
interface TravelOrderRow {
  id: string;
  to_number: number;
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
  // Joined columns
  plate_number?: string;
  driver_name?: string;
}

/** API response shape sent to the frontend. */
interface TravelOrderResponse {
  id: string;
  toNumber: number;
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
  createdAt: string;
  updatedAt: string;
}

// GET /api/travel-orders — List all with left-joined vehicle & driver
router.get('/', async (_req: Request, res: Response) => {
  try {
    const pool = getPool();
    const result = await pool.query<TravelOrderRow>(`
      SELECT
        to_.*,
        v.plate_number,
        d.full_name AS driver_name
      FROM travel_orders to_
      LEFT JOIN vehicles v ON v.id = to_.vehicle_id
      LEFT JOIN drivers  d ON d.id = to_.driver_id
      ORDER BY to_.created_at DESC
    `);
    const data = result.rows.map(mapRow);
    res.json({ success: true, data, message: 'Travel orders retrieved successfully' });
  } catch (error) {
    console.error('GET /api/travel-orders error:', (error as Error).message);
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
        d.full_name AS driver_name
      FROM travel_orders to_
      LEFT JOIN vehicles v ON v.id = to_.vehicle_id
      LEFT JOIN drivers  d ON d.id = to_.driver_id
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
  } = req.body;

  if (!destinationLocation) {
    res.status(400).json({
      success: false,
      data: null,
      error: 'Destination is required',
    });
    return;
  }

  try {
    const pool = getPool();
    const result = await pool.query<TravelOrderRow>(`
      INSERT INTO travel_orders
        (vehicle_id, driver_id, origin_location, destination_target,
         scheduled_departure, scheduled_arrival, purpose_of_travel, notes,
         department, traveler_name, request_vehicle, request_driver)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `, [
      vehicleId || null, driverId || null, originLocation || '', destinationLocation,
      scheduledDepartureAt, scheduledArrivalAt || null,
      purpose || '', notes || '',
      department || '', travelerName || '',
      requestVehicle ?? false, requestDriver ?? false,
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

// PATCH /api/travel-orders/:id — Update a travel order (e.g. status)
router.patch('/:id', async (req: Request, res: Response) => {
  const allowedFields = ['status', 'notes'];
  const updates: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      // Convert camelCase from request body to snake_case column name
      const col = field.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
      updates.push(`${col} = $${idx++}`);
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export default router;