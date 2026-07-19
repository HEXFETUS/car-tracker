import express, { type Request, type Response, type Router as ExpressRouter } from 'express';
import type { ApiResponse } from '@car-tracker/shared';
import { getPool } from '../db/db.js';
import { publicSubmissionRateLimit } from '../middleware/rate-limit.js';

const router: ExpressRouter = express.Router();

/** Minimal row shape returned by INSERT/query. */
interface TravelOrderRow {
  id: string;
  to_number: string;
  status: string;
}

/**
 * GET /api/public/travel-orders/next-number
 * Public endpoint — no auth required.
 * Returns the next available TO sequence number for the current year.
 */
router.get('/next-number', async (_req: Request, res: Response) => {
  try {
    const pool = getPool();
    const year = new Date().getFullYear();
    const result = await pool.query<{ max_seq: number | null }>(
      `SELECT MAX(CAST(SPLIT_PART(to_number, '-', 3) AS INTEGER)) AS max_seq
       FROM travel_orders
       WHERE to_number LIKE $1`,
      [`TO-${year}-%`],
    );
    const maxSeq = result.rows[0]?.max_seq ?? 0;
    res.json({ success: true, data: maxSeq + 1, error: null });
  } catch (error) {
    console.error('GET /public/travel-orders/next-number error:', (error as Error).message);
    res.status(500).json({ success: false, data: null, error: 'Database error' });
  }
});

/**
 * POST /api/public/travel-orders
 * Public endpoint — no auth required.
 * Creates a new travel order with status PENDING.
 */
router.post('/', publicSubmissionRateLimit, async (req: Request, res: Response) => {
  const {
    toNumber,
    originLocation,
    destinationLocation,
    scheduledDepartureAt,
    scheduledArrivalAt,
    purpose,
    notes,
    department,
    travelerName,
    requestVehicle,
    requestDriver,
    latLongOrigin,
    latLongDestination,
  } = req.body;

  if (!toNumber || !originLocation || !destinationLocation) {
    res.status(400).json({
      success: false,
      data: null,
      error: 'Missing required fields: toNumber, originLocation, destinationLocation',
    });
    return;
  }

  try {
    const pool = getPool();
    const result = await pool.query<TravelOrderRow>(`
      INSERT INTO travel_orders
        (to_number, origin_location, destination_target, scheduled_departure, scheduled_arrival,
         purpose_of_travel, notes, department, traveler_name,
         request_vehicle, request_driver, lat_long_origin, lat_long_destination, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'PENDING')
      RETURNING id, to_number, status
    `, [
      toNumber,
      originLocation || '',
      destinationLocation || '',
      scheduledDepartureAt || null,
      scheduledArrivalAt || null,
      purpose || '',
      notes || '',
      department || '',
      travelerName || '',
      requestVehicle ?? false,
      requestDriver ?? false,
      latLongOrigin ?? null,
      latLongDestination ?? null,
    ]);

    res.json({
      success: true,
      data: result.rows[0],
      error: null,
    });
  } catch (error) {
    console.error('POST /public/travel-orders error:', (error as Error).message);
    res.status(500).json({ success: false, data: null, error: 'Failed to create travel order' });
  }
});

export default router;
