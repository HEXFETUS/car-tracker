import express, { type Request, type Response, type Router as ExpressRouter } from 'express';
import type { ApiResponse } from '@car-tracker/shared';
import { getPool } from '../db/db.js';
import { validateUuidParam } from '../middleware/validate-uuid.js';

const router: ExpressRouter = express.Router();
router.param('id', validateUuidParam);

export interface MaintenanceRow {
  id: string;
  vehicle_id: string;
  service_type: string;
  cost: string; // numeric from pg
  date: string;
  remarks: string | null;
  receipt_number: string | null;
  attached_picture: string | null;
  created_at: string;
  updated_at: string;
  // Joined from vehicles table
  plate_number?: string;
  vehicle_make?: string;
  vehicle_model?: string;
  vehicle_year?: number;
}

function mapRow(row: MaintenanceRow) {
  return {
    id: row.id,
    vehicleId: row.vehicle_id,
    vehiclePlate: row.plate_number ?? undefined,
    vehicleName: row.vehicle_make && row.vehicle_model
      ? `${row.vehicle_year} ${row.vehicle_make} ${row.vehicle_model}`
      : undefined,
    serviceType: row.service_type,
    cost: Number(row.cost),
    date: row.date,
    remarks: row.remarks ?? undefined,
    receiptNumber: row.receipt_number ?? undefined,
    attachedPicture: row.attached_picture ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// GET /api/maintenance — List all maintenance records (with vehicle info)
router.get('/', async (_req: Request, res: Response) => {
  try {
    const pool = getPool();
    const result = await pool.query<MaintenanceRow>(
      `SELECT m.*,
              v.plate_number,
              v.make AS vehicle_make,
              v.model AS vehicle_model,
              v.year AS vehicle_year
       FROM maintenance m
       LEFT JOIN vehicles v ON v.id = m.vehicle_id
       ORDER BY m.date DESC, m.created_at DESC`,
    );
    const data = result.rows.map(mapRow);
    const response: ApiResponse<typeof data> = {
      success: true,
      data,
      message: 'Maintenance records retrieved successfully',
    };
    res.json(response);
  } catch (error) {
    console.error('GET /api/maintenance error:', (error as Error).message);
    res.status(500).json({ success: false, data: null, error: 'Database error' });
  }
});

// GET /api/maintenance/:id — Get single maintenance record
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const result = await pool.query<MaintenanceRow>(
      `SELECT m.*,
              v.plate_number,
              v.make AS vehicle_make,
              v.model AS vehicle_model,
              v.year AS vehicle_year
       FROM maintenance m
       LEFT JOIN vehicles v ON v.id = m.vehicle_id
       WHERE m.id = $1`,
      [req.params.id],
    );
    if (result.rows.length === 0) {
      res.status(404).json({ success: false, data: null, error: 'Maintenance record not found' });
      return;
    }
    res.json({ success: true, data: mapRow(result.rows[0]) });
  } catch (error) {
    console.error('GET /api/maintenance/:id error:', (error as Error).message);
    res.status(500).json({ success: false, data: null, error: 'Database error' });
  }
});

// POST /api/maintenance — Create a new maintenance record
router.post('/', async (req: Request, res: Response) => {
  const { vehicleId, serviceType, cost, date, remarks, receiptNumber, attachedPicture } = req.body;

  if (!vehicleId || !serviceType || cost === undefined || !date) {
    res.status(400).json({
      success: false,
      data: null,
      error: 'vehicleId, serviceType, cost, and date are required',
    });
    return;
  }

  try {
    const pool = getPool();
    const result = await pool.query<MaintenanceRow>(
      `INSERT INTO maintenance (vehicle_id, service_type, cost, date, remarks, receipt_number, attached_picture)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [vehicleId, serviceType, Number(cost), date, remarks || null, receiptNumber || null, attachedPicture || null],
    );

    // Also fetch vehicle info for the response
    const vehicleResult = await pool.query<{ plate_number: string; make: string; model: string; year: number }>(
      'SELECT plate_number, make, model, year FROM vehicles WHERE id = $1',
      [vehicleId],
    );

    const row = result.rows[0];
    const vehicle = vehicleResult.rows[0];

    const data = {
      id: row.id,
      vehicleId: row.vehicle_id,
      vehiclePlate: vehicle?.plate_number ?? undefined,
      vehicleName: vehicle ? `${vehicle.year} ${vehicle.make} ${vehicle.model}` : undefined,
      serviceType: row.service_type,
      cost: Number(row.cost),
      date: row.date,
      remarks: row.remarks ?? undefined,
      receiptNumber: row.receipt_number ?? undefined,
      attachedPicture: row.attached_picture ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };

    res.status(201).json({
      success: true,
      data,
      message: 'Maintenance record created successfully',
    });
  } catch (error) {
    console.error('POST /api/maintenance error:', (error as Error).message);
    res.status(500).json({ success: false, data: null, error: 'Database error' });
  }
});

// PUT /api/maintenance/:id — Update a maintenance record
router.put('/:id', async (req: Request, res: Response) => {
  const { vehicleId, serviceType, cost, date, remarks, receiptNumber, attachedPicture } = req.body;

  if (!vehicleId || !serviceType || cost === undefined || !date) {
    res.status(400).json({
      success: false,
      data: null,
      error: 'vehicleId, serviceType, cost, and date are required',
    });
    return;
  }

  try {
    const pool = getPool();
    const result = await pool.query<MaintenanceRow>(
      `UPDATE maintenance
       SET vehicle_id = $1, service_type = $2, cost = $3, date = $4, remarks = $5, receipt_number = $6, attached_picture = $7
       WHERE id = $8
       RETURNING *`,
      [vehicleId, serviceType, Number(cost), date, remarks || null, receiptNumber || null, attachedPicture || null, req.params.id],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, data: null, error: 'Maintenance record not found' });
      return;
    }

    // Fetch vehicle info
    const vehicleResult = await pool.query<{ plate_number: string; make: string; model: string; year: number }>(
      'SELECT plate_number, make, model, year FROM vehicles WHERE id = $1',
      [vehicleId],
    );

    const row = result.rows[0];
    const vehicle = vehicleResult.rows[0];

    const data = {
      id: row.id,
      vehicleId: row.vehicle_id,
      vehiclePlate: vehicle?.plate_number ?? undefined,
      vehicleName: vehicle ? `${vehicle.year} ${vehicle.make} ${vehicle.model}` : undefined,
      serviceType: row.service_type,
      cost: Number(row.cost),
      date: row.date,
      remarks: row.remarks ?? undefined,
      receiptNumber: row.receipt_number ?? undefined,
      attachedPicture: row.attached_picture ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };

    res.json({ success: true, data, message: 'Maintenance record updated successfully' });
  } catch (error) {
    console.error('PUT /api/maintenance/:id error:', (error as Error).message);
    res.status(500).json({ success: false, data: null, error: 'Database error' });
  }
});

// DELETE /api/maintenance/:id — Delete a maintenance record
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const result = await pool.query<MaintenanceRow>(
      'DELETE FROM maintenance WHERE id = $1 RETURNING id',
      [req.params.id],
    );
    if (result.rows.length === 0) {
      res.status(404).json({ success: false, data: null, error: 'Maintenance record not found' });
      return;
    }
    res.json({ success: true, data: null, message: 'Maintenance record deleted successfully' });
  } catch (error) {
    console.error('DELETE /api/maintenance/:id error:', (error as Error).message);
    res.status(500).json({ success: false, data: null, error: 'Database error' });
  }
});

export default router;
