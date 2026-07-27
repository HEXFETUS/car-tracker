import express, { type Request, type Response, type Router as ExpressRouter } from 'express';
import type { ApiResponse } from '@car-tracker/shared';
import { getPool } from '../db/db.js';
import { validateUuidParam } from '../middleware/validate-uuid.js';
import { DEFAULT_ORIGIN_ADDRESS, DEFAULT_ORIGIN_LATLONG } from '../config/constants.js';
import { syncTravelOrderToActiveTrip } from '../services/travelOrderSyncService.js';
import { createNotificationForRoles } from '../services/notificationService.js';

const router: ExpressRouter = express.Router();
router.param('id', validateUuidParam);

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
  department?: string | null;
  traveler_name?: string | null;
  request_vehicle?: boolean;
  request_driver?: boolean;
  notes?: string | null;
  approved_by?: string | null;
  requested_by?: string | null;
  traveler_signature?: string | null;
  requested_by_signature?: string | null;
  approved_by_signature?: string | null;
  lat_long_origin?: string | null;
  lat_long_destination?: string | null;
  location_name?: string | null;
  plate_number?: string;
  driver_name?: string;
  approver_name?: string | null;
  requester_name?: string | null;
}

interface DestinationRow {
  id: string;
  travel_order_id: string;
  stop_order: number;
  location_name: string;
  address: string | null;
  lat_long: string | null;
  notes: string | null;
  estimated_arrival: string | null;
  status: string;
  arrived_at: string | null;
  arrival_distance_meters: number | null;
  gps_trip_log_id: string | null;
  created_at: string;
}

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
  locationName?: string | null;
  destinations: DestinationResponse[];
  vehicleMake?: string | null;
  vehicleModel?: string | null;
  travelerSignature?: string | null;
  requestedBySignature?: string | null;
  approvedBySignature?: string | null;
  requestedBy?: { fullName?: string | null; position?: string | null } | null;
}

interface DestinationResponse {
  id: string;
  stopOrder: number;
  locationName: string;
  address: string | null;
  latLong: string | null;
  notes: string | null;
  estimatedArrival: string | null;
  status: string;
  arrivedAt: string | null;
  arrivalDistanceMeters: number | null;
  gpsTripLogId: string | null;
}

async function fetchDestinations(travelOrderId: string): Promise<DestinationResponse[]> {
  const pool = getPool();
  const result = await pool.query<DestinationRow>(
    `SELECT * FROM travel_order_destinations
     WHERE travel_order_id = $1
     ORDER BY stop_order ASC`,
    [travelOrderId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    stopOrder: row.stop_order,
    locationName: row.location_name,
    address: row.address,
    latLong: row.lat_long,
    notes: row.notes,
    estimatedArrival: row.estimated_arrival,
    status: row.status,
    arrivedAt: row.arrived_at,
    arrivalDistanceMeters: row.arrival_distance_meters,
    gpsTripLogId: row.gps_trip_log_id,
  }));
}

async function mapRow(row: TravelOrderRow): Promise<TravelOrderResponse> {
  const destinations = await fetchDestinations(row.id);
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
    locationName: row.location_name ?? null,
    destinations,
    vehicleMake: (row as any).vehicle_make ?? null,
    vehicleModel: (row as any).vehicle_model ?? null,
    travelerSignature: row.traveler_signature ?? null,
    requestedBySignature: row.requested_by_signature ?? null,
    approvedBySignature: row.approved_by_signature ?? null,
    requestedBy: row.requester_name ? { fullName: row.requester_name } : null,
  };
}

router.get('/pending', async (_req: Request, res: Response) => {
  try {
    const pool = getPool();
    const result = await pool.query<TravelOrderRow>(`
      SELECT
        to_.*,
        v.plate_number,
        v.make AS vehicle_make,
        v.model AS vehicle_model,
        d.full_name AS driver_name,
        u.name AS approver_name,
        r.name AS requester_name
      FROM travel_orders to_
      LEFT JOIN vehicles v ON v.id = to_.vehicle_id
      LEFT JOIN drivers  d ON d.id = to_.driver_id
      LEFT JOIN users   u ON u.id = to_.approved_by
      LEFT JOIN users   r ON r.id = to_.requested_by
      WHERE to_.status = 'PENDING'
        AND to_.vehicle_id IS NULL
        AND to_.driver_id IS NULL
      ORDER BY to_.created_at DESC
    `);
    const data = await Promise.all(result.rows.map(mapRow));
    res.json({ success: true, data, message: 'Pending travel orders retrieved successfully' });
  } catch (error) {
    console.error('GET /api/travel-orders/pending error:', (error as Error).message);
    res.status(500).json({ success: false, data: null, error: 'Database error' });
  }
});

router.get('/approved', async (_req: Request, res: Response) => {
  try {
    const pool = getPool();
    const result = await pool.query<TravelOrderRow>(`
      SELECT
        to_.*,
        v.plate_number,
        v.make AS vehicle_make,
        v.model AS vehicle_model,
        d.full_name AS driver_name,
        u.name AS approver_name,
        r.name AS requester_name
      FROM travel_orders to_
      LEFT JOIN vehicles v ON v.id = to_.vehicle_id
      LEFT JOIN drivers  d ON d.id = to_.driver_id
      LEFT JOIN users   u ON u.id = to_.approved_by
      LEFT JOIN users   r ON r.id = to_.requested_by
      WHERE to_.status = 'APPROVED'
      ORDER BY to_.created_at DESC
    `);
    const data = await Promise.all(result.rows.map(mapRow));
    res.json({ success: true, data, message: 'Approved travel orders retrieved successfully' });
  } catch (error) {
    console.error('GET /api/travel-orders/approved error:', (error as Error).message);
    res.status(500).json({ success: false, data: null, error: 'Database error' });
  }
});

router.get('/for-approval', async (_req: Request, res: Response) => {
  try {
    const pool = getPool();
    const result = await pool.query<TravelOrderRow>(`
      SELECT
        to_.*,
        v.plate_number,
        v.make AS vehicle_make,
        v.model AS vehicle_model,
        d.full_name AS driver_name,
        u.name AS approver_name,
        r.name AS requester_name
      FROM travel_orders to_
      LEFT JOIN vehicles v ON v.id = to_.vehicle_id
      LEFT JOIN drivers  d ON d.id = to_.driver_id
      LEFT JOIN users   u ON u.id = to_.approved_by
      LEFT JOIN users   r ON r.id = to_.requested_by
      WHERE to_.status = 'FOR_APPROVAL'
        AND to_.vehicle_id IS NOT NULL
        AND to_.driver_id IS NOT NULL
      ORDER BY to_.created_at DESC
    `);
    const data = await Promise.all(result.rows.map(mapRow));
    res.json({ success: true, data, message: 'For-approval travel orders retrieved successfully' });
  } catch (error) {
    console.error('GET /api/travel-orders/for-approval error:', (error as Error).message);
    res.status(500).json({ success: false, data: null, error: 'Database error' });
  }
});

router.get('/cancelled', async (_req: Request, res: Response) => {
  try {
    const pool = getPool();
    const result = await pool.query<TravelOrderRow>(`
      SELECT
        to_.*,
        v.plate_number,
        v.make AS vehicle_make,
        v.model AS vehicle_model,
        d.full_name AS driver_name,
        u.name AS approver_name,
        r.name AS requester_name
      FROM travel_orders to_
      LEFT JOIN vehicles v ON v.id = to_.vehicle_id
      LEFT JOIN drivers  d ON d.id = to_.driver_id
      LEFT JOIN users   u ON u.id = to_.approved_by
      LEFT JOIN users   r ON r.id = to_.requested_by
      WHERE to_.status = 'CANCELLED'
      ORDER BY to_.created_at DESC
    `);
    const data = await Promise.all(result.rows.map(mapRow));
    res.json({ success: true, data, message: 'Cancelled travel orders retrieved successfully' });
  } catch (error) {
    console.error('GET /api/travel-orders/cancelled error:', (error as Error).message);
    res.status(500).json({ success: false, data: null, error: 'Database error' });
  }
});

router.get('/for-request', async (_req: Request, res: Response) => {
  try {
    const pool = getPool();
    const result = await pool.query<TravelOrderRow>(`
      SELECT
        to_.*,
        v.plate_number,
        v.make AS vehicle_make,
        v.model AS vehicle_model,
        d.full_name AS driver_name,
        u.name AS approver_name,
        r.name AS requester_name
      FROM travel_orders to_
      LEFT JOIN vehicles v ON v.id = to_.vehicle_id
      LEFT JOIN drivers  d ON d.id = to_.driver_id
      LEFT JOIN users   u ON u.id = to_.approved_by
      LEFT JOIN users   r ON r.id = to_.requested_by
      WHERE to_.status = 'FOR_REQUEST'
      ORDER BY to_.created_at DESC
    `);
    const data = await Promise.all(result.rows.map(mapRow));
    res.json({ success: true, data, message: 'For-request travel orders retrieved successfully' });
  } catch (error) {
    console.error('GET /api/travel-orders/for-request error:', (error as Error).message);
    res.status(500).json({ success: false, data: null, error: 'Database error' });
  }
});

router.get('/scheduled', async (_req: Request, res: Response) => {
  try {
    const pool = getPool();
    const result = await pool.query<TravelOrderRow>(`
      SELECT
        to_.*,
        v.plate_number,
        d.full_name AS driver_name,
        u.name AS approver_name,
        r.name AS requester_name
      FROM travel_orders to_
      LEFT JOIN vehicles v ON v.id = to_.vehicle_id
      LEFT JOIN drivers  d ON d.id = to_.driver_id
      LEFT JOIN users   u ON u.id = to_.approved_by
      LEFT JOIN users   r ON r.id = to_.requested_by
      WHERE to_.status IN ('FOR_APPROVAL','APPROVED','ACTIVE')
        AND to_.scheduled_departure IS NOT NULL
      ORDER BY to_.scheduled_departure ASC
    `);
    const data = await Promise.all(result.rows.map(mapRow));
    res.json({ success: true, data, message: 'Scheduled travel orders retrieved successfully' });
  } catch (error) {
    console.error('GET /api/travel-orders/scheduled error:', (error as Error).message);
    res.status(500).json({ success: false, data: null, error: 'Database error' });
  }
});

router.get('/:id/destinations', async (req: Request, res: Response) => {
  try {
    const data = await fetchDestinations(req.params.id);
    res.json({ success: true, data, message: 'Destinations retrieved successfully' });
  } catch (error) {
    console.error('GET /api/travel-orders/:id/destinations error:', (error as Error).message);
    res.status(500).json({ success: false, data: null, error: 'Database error' });
  }
});

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
    const VALID_PLATES = ['KAR6444', 'KAR6412', 'KAR6558'];
    const vehicleResult = await pool.query(
      'SELECT id, plate_number FROM vehicles WHERE id = $1',
      [vehicle_id],
    );

    if (vehicleResult.rows.length === 0) {
      res.status(404).json({ success: false, data: null, error: 'Vehicle not found' });
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

    const driverResult = await pool.query(
      'SELECT id FROM drivers WHERE id = $1',
      [driver_id],
    );

    if (driverResult.rows.length === 0) {
      res.status(404).json({ success: false, data: null, error: 'Driver not found' });
      return;
    }

    const updateResult = await pool.query<TravelOrderRow>(
      `UPDATE travel_orders
       SET vehicle_id = $1, driver_id = $2, status = 'FOR_APPROVAL', updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [vehicle_id, driver_id, req.params.id],
    );

    if (updateResult.rows.length === 0) {
      res.status(404).json({ success: false, data: null, error: 'Travel order not found' });
      return;
    }

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
      data: await mapRow(fullResult.rows[0]),
      message: 'Travel order assigned successfully',
    });
  } catch (error) {
    console.error('PATCH /api/travel-orders/:id/assign error:', (error as Error).message);
    res.status(500).json({ success: false, data: null, error: 'Database error' });
  }
});

router.get('/', async (_req: Request, res: Response) => {
  try {
    const pool = getPool();
    const result = await pool.query<TravelOrderRow>(`
      SELECT
        to_.*,
        v.plate_number,
        d.full_name AS driver_name,
        u.name AS approver_name,
        r.name AS requester_name
      FROM travel_orders to_
      LEFT JOIN vehicles v ON v.id = to_.vehicle_id
      LEFT JOIN drivers  d ON d.id = to_.driver_id
      LEFT JOIN users   u ON u.id = to_.approved_by
      LEFT JOIN users   r ON r.id = to_.requested_by
      ORDER BY to_.created_at DESC
    `);
    const data = await Promise.all(result.rows.map(mapRow));
    res.json({ success: true, data, message: 'Travel orders retrieved successfully' });
  } catch (error) {
    console.error('GET /api/travel-orders error:', (error as Error).message);
    res.status(500).json({ success: false, data: null, error: 'Database error' });
  }
});

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
    const nextSeq = (result.rows[0]?.max_seq ?? 0) + 1;
    res.json({ success: true, data: nextSeq, message: 'Next TO number retrieved' });
  } catch (error) {
    console.error('GET /api/travel-orders/next-number error:', (error as Error).message);
    res.status(500).json({ success: false, data: null, error: 'Database error' });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const result = await pool.query<TravelOrderRow>(`
      SELECT
        to_.*,
        v.plate_number,
        d.full_name AS driver_name,
        u.name AS approver_name,
        r.name AS requester_name
      FROM travel_orders to_
      LEFT JOIN vehicles v ON v.id = to_.vehicle_id
      LEFT JOIN drivers  d ON d.id = to_.driver_id
      LEFT JOIN users   u ON u.id = to_.approved_by
      LEFT JOIN users   r ON r.id = to_.requested_by
      WHERE to_.id = $1
    `, [req.params.id]);
    if (result.rows.length === 0) {
      res.status(404).json({ success: false, data: null, error: 'Travel order not found' });
      return;
    }
    const data = await mapRow(result.rows[0]);
    res.json({ success: true, data });
  } catch (error) {
    console.error('GET /api/travel-orders/:id error:', (error as Error).message);
    res.status(500).json({ success: false, data: null, error: 'Database error' });
  }
});

router.post('/', async (req: Request, res: Response) => {
  const {
    vehicleId, driverId, originLocation, destinationLocation,
    scheduledDepartureAt, scheduledArrivalAt, purpose, notes,
    department, travelerName, requestVehicle, requestDriver,
    toNumber,
    latLongOrigin, latLongDestination,
    destinations,
    travelerSignature,
  } = req.body;

  if (!destinationLocation && (!destinations || destinations.length === 0)) {
    res.status(400).json({
      success: false,
      data: null,
      error: 'At least one destination is required',
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
    const scheduledDepartureValue = scheduledDepartureAt;
    const scheduledArrivalValue = scheduledArrivalAt || null;

    const originNormalized = (originLocation || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const defaultNormalized = DEFAULT_ORIGIN_ADDRESS.replace(/\s+/g, ' ').trim().toLowerCase();
    const isDefaultOrigin = !originLocation || originNormalized === defaultNormalized;

    const resolvedOriginLocation = isDefaultOrigin ? DEFAULT_ORIGIN_ADDRESS : (originLocation || '');
    const finalLatLongOrigin = isDefaultOrigin
      ? DEFAULT_ORIGIN_LATLONG
      : (latLongOrigin || null);

    const destList = destinations && destinations.length > 0
      ? destinations.map((d: any, i: number) => ({
        locationName: d.locationName || d.location_name || '',
        address: d.address || null,
        latLong: d.latLong || d.lat_long || null,
        notes: d.notes || null,
        estimatedArrival: d.estimatedArrival || d.estimated_arrival || null,
        stopOrder: d.stopOrder ?? d.stop_order ?? i + 1,
      }))
      : destinationLocation
        ? [{ locationName: destinationLocation, address: null, latLong: latLongDestination || null, notes: null, estimatedArrival: null, stopOrder: 1 }]
        : [];

    const lastDest = destList[destList.length - 1];
    const finalDestination = lastDest?.locationName || destinationLocation || '';
    const finalLatLong = lastDest?.latLong || latLongDestination || null;

    console.log('[TO Create] Backend received scheduled_departure:', scheduledDepartureValue);
    console.log('[TO Create] Backend received scheduled_arrival:', scheduledArrivalValue);

    const client = await pool.connect();
    let createdRow: TravelOrderRow | undefined;
    try {
      await client.query('BEGIN');

      const result = await client.query<TravelOrderRow>(`
        INSERT INTO travel_orders
          (to_number, vehicle_id, driver_id, origin_location, destination_target,
           scheduled_departure, scheduled_arrival, purpose_of_travel, notes,
           department, traveler_name, request_vehicle, request_driver,
           lat_long_origin, lat_long_destination, location_name,
           traveler_signature)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        RETURNING *
      `, [
        toNumber,
        vehicleId || null, driverId || null, resolvedOriginLocation, finalDestination,
        scheduledDepartureValue, scheduledArrivalValue,
        purpose || '', notes || '',
        department || '', travelerName || '',
        requestVehicle ?? false, requestDriver ?? false,
        finalLatLongOrigin, finalLatLong,
        finalDestination,
        travelerSignature || null,
      ]);

      createdRow = result.rows[0];
      console.log('[TO Create] DB returned travelOrderId:', createdRow.id);

      if (destList.length > 0) {
        for (const dest of destList) {
          await client.query(
            `INSERT INTO travel_order_destinations
               (travel_order_id, stop_order, location_name, address, lat_long, notes, estimated_arrival)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              createdRow.id,
              dest.stopOrder,
              dest.locationName,
              dest.address,
              dest.latLong,
              dest.notes,
              dest.estimatedArrival,
            ],
          );
        }
        console.log(`[TO Create] Inserted ${destList.length} destinations for travel order ${createdRow.id}`);
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    res.status(201).json({
      success: true,
      data: await mapRow(createdRow),
      message: 'Travel order created successfully',
    });
  } catch (error) {
    console.error('POST /api/travel-orders error:', (error as Error).message);
    res.status(500).json({ success: false, data: null, error: 'Database error' });
  }
});

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

router.patch('/:id', async (req: Request, res: Response) => {
  console.log('PATCH BODY:', JSON.stringify(req.body).slice(0, 200));
  console.log('APPROVE signature:', req.body.approvedBySignature?.slice(0, 50));
  console.log('REQUEST signature:', req.body.requestedBySignature?.slice(0, 50));
  const fieldMap: Record<string, string> = {
    status: 'status',
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
    locationName: 'location_name',
    travelerSignature: 'traveler_signature',
  };
  const allowedFields = Object.keys(fieldMap);
  const updates: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      if (field === 'originLocation') {
        const originNormalized = (req.body[field] || '').replace(/\s+/g, ' ').trim().toLowerCase();
        const defaultNormalized = DEFAULT_ORIGIN_ADDRESS.replace(/\s+/g, ' ').trim().toLowerCase();
        const isDefaultOrigin = !req.body[field] || originNormalized === defaultNormalized;

        if (isDefaultOrigin) {
          updates.push(`${fieldMap[field]} = $${idx++}`);
          values.push(DEFAULT_ORIGIN_ADDRESS);
          updates.push(`lat_long_origin = $${idx++}`);
          values.push(DEFAULT_ORIGIN_LATLONG);
          continue;
        }
      }

      updates.push(`${fieldMap[field]} = $${idx++}`);
      values.push(req.body[field]);
    }
  }

  // When transitioning to FOR_REQUEST, stamp the requesting user and signature
  if (req.body.status === 'FOR_REQUEST') {
    const requestingUserId = req.auth?.id;
    if (requestingUserId) {
      updates.push(`requested_by = $${idx++}`);
      values.push(requestingUserId);
    }
    if (req.body.requestedBySignature !== undefined) {
      updates.push(`requested_by_signature = $${idx++}`);
      values.push(req.body.requestedBySignature as string | null);
    }
  }

  // When transitioning to APPROVED, stamp the approving user and signature
  if (req.body.status === 'APPROVED') {
    const approvingUserId = req.auth?.id;
    if (approvingUserId) {
      updates.push(`approved_by = $${idx++}`);
      values.push(approvingUserId);
    }
    if (req.body.approvedBySignature !== undefined) {
      updates.push(`approved_by_signature = $${idx++}`);
      values.push(req.body.approvedBySignature as string | null);
    } else if (approvingUserId) {
      updates.push(`approved_by_signature = $${idx++}`);
      values.push(null as string | null);
    }
  }

  if (updates.length === 0 && !req.body.destinations) {
    res.status(400).json({ success: false, data: null, error: 'No valid fields to update' });
    return;
  }

  try {
    const pool = getPool();

    if (updates.length > 0) {
      values.push(req.params.id);
    }

    const client = await pool.connect();
    let updatedRow: TravelOrderRow | undefined;
    try {
      await client.query('BEGIN');

      if (updates.length > 0) {
        const result = await client.query<TravelOrderRow>(
          `UPDATE travel_orders SET ${updates.join(', ')} WHERE id = $${idx}
           RETURNING *`,
          values,
        );
        if (result.rows.length === 0) {
          await client.query('ROLLBACK');
          res.status(404).json({ success: false, data: null, error: 'Travel order not found' });
          return;
        }
        updatedRow = result.rows[0];
      } else {
        updatedRow = await pool.query<TravelOrderRow>(
          `SELECT * FROM travel_orders WHERE id = $1`,
          [req.params.id],
        ).then(r => r.rows[0]);
        if (!updatedRow) {
          res.status(404).json({ success: false, data: null, error: 'Travel order not found' });
          return;
        }
      }

      if (req.body.destinations && Array.isArray(req.body.destinations)) {
        await client.query(
          'DELETE FROM travel_order_destinations WHERE travel_order_id = $1',
          [req.params.id],
        );

        for (const dest of req.body.destinations) {
          await client.query(
            `INSERT INTO travel_order_destinations
               (travel_order_id, stop_order, location_name, address, lat_long, notes, estimated_arrival)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              req.params.id,
              dest.stopOrder ?? dest.stop_order ?? 1,
              dest.locationName || dest.location_name || '',
              dest.address || null,
              dest.latLong || dest.lat_long || null,
              dest.notes || null,
              dest.estimatedArrival || dest.estimated_arrival || null,
            ],
          );
        }
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    const fullResult = await pool.query<TravelOrderRow>(`
      SELECT
        to_.*,
        v.plate_number,
        d.full_name AS driver_name,
        u.name AS approver_name,
        r.name AS requester_name
      FROM travel_orders to_
      LEFT JOIN vehicles v ON v.id = to_.vehicle_id
      LEFT JOIN drivers  d ON d.id = to_.driver_id
      LEFT JOIN users   u ON u.id = to_.approved_by
      LEFT JOIN users   r ON r.id = to_.requested_by
      WHERE to_.id = $1
    `, [req.params.id]);

    if (['APPROVED', 'ACTIVE'].includes(String(fullResult.rows[0]?.status ?? '').toUpperCase())) {
      try {
        const syncResult = await syncTravelOrderToActiveTrip(req.params.id);
        console.log('[TO Sync] status update active-trip sync', syncResult);
      } catch (syncError) {
        console.error('[TO Sync] status update active-trip sync failed:', (syncError as Error).message);
      }
    }

    // Send notifications based on status change
    if (updatedRow && req.body.status) {
      try {
        const newStatus = String(req.body.status).toUpperCase();
        const prevStatus = String(updatedRow.status).toUpperCase();
        
        // Only send notifications for APPROVED or CANCELLED status changes
        if (['APPROVED', 'CANCELLED'].includes(newStatus)) {
          const toNumber = updatedRow.to_number;
          const rolesToNotify: string[] = ['SUPERADMIN'];
          
          // Determine which roles to notify based on previous status
          if (prevStatus === 'PENDING') {
            rolesToNotify.push('HR');
          } else if (prevStatus === 'FOR_REQUEST') {
            rolesToNotify.push('DISPATCHER');
          } else if (prevStatus === 'FOR_APPROVAL') {
            rolesToNotify.push('ADMIN');
          }
          
          // Remove duplicates and send notification
          const uniqueRoles = Array.from(new Set(rolesToNotify));
          
          await createNotificationForRoles(uniqueRoles, {
            type: 'travel_request',
            title: `Travel Order ${newStatus}`,
            message: `Travel Order ${toNumber} has been ${newStatus.toLowerCase()}.`,
            targetUrl: '/travel-orders',
            targetTab: newStatus.toLowerCase(),
            entityId: updatedRow.id,
          });
        }
      } catch (notifError) {
        console.error(`[travel-orders] Failed to create notification for TO ${updatedRow.id}:`, (notifError as Error).message);
      }
    }

    res.json({ success: true, data: await mapRow(fullResult.rows[0]), message: 'Travel order updated' });
  } catch (error) {
    console.error('PATCH /api/travel-orders/:id error:', (error as Error).message);
    res.status(500).json({ success: false, data: null, error: 'Database error' });
  }
});

export default router;
