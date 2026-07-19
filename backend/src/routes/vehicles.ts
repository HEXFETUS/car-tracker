import express, { type Request, type Response, type Router as ExpressRouter } from 'express';
import type { ApiResponse } from '@car-tracker/shared';
import { getPool } from '../db/db.js';
import { validateUuidParam } from '../middleware/validate-uuid.js';

const router: ExpressRouter = express.Router();
router.param('id', validateUuidParam);

export interface VehicleRow {
  id: string;
  plate_number: string;
  make: string;
  model: string;
  year: number;
  color: string | null;
  vehicle_type: string | null;
  fuel_type: string | null;
  under_repair: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// GET /api/vehicles — List all vehicles
router.get('/', async (_req: Request, res: Response) => {
  try {
    const pool = getPool();
    const result = await pool.query<VehicleRow>(
      'SELECT * FROM vehicles ORDER BY created_at DESC',
    );
    const data = result.rows.map(mapRow);
    const response: ApiResponse<typeof data> = {
      success: true,
      data,
      message: 'Vehicles retrieved successfully',
    };
    res.json(response);
  } catch (error) {
    console.error('GET /api/vehicles error:', (error as Error).message);
    res.status(500).json({ success: false, data: null, error: 'Database error' });
  }
});

// GET /api/vehicles/:id — Get single vehicle
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const result = await pool.query<VehicleRow>(
      'SELECT * FROM vehicles WHERE id = $1',
      [req.params.id],
    );
    if (result.rows.length === 0) {
      res.status(404).json({ success: false, data: null, error: 'Vehicle not found' });
      return;
    }
    res.json({ success: true, data: mapRow(result.rows[0]) });
  } catch (error) {
    console.error('GET /api/vehicles/:id error:', (error as Error).message);
    res.status(500).json({ success: false, data: null, error: 'Database error' });
  }
});

// POST /api/vehicles — Create a new vehicle
router.post('/', async (req: Request, res: Response) => {
  const { plateNumber, make, model, year, color, vehicleType, fuelType } = req.body;

  if (!plateNumber || !make || !model || !year) {
    res.status(400).json({
      success: false,
      data: null,
      error: 'Plate Number, Make, Model, and Year are required',
    });
    return;
  }

  try {
    const pool = getPool();

    // Check duplicate plate
    const existing = await pool.query<VehicleRow>(
      'SELECT id FROM vehicles WHERE plate_number = $1',
      [plateNumber],
    );
    if (existing.rows.length > 0) {
      res.status(409).json({
        success: false,
        data: null,
        error: 'A vehicle with this plate number already exists',
      });
      return;
    }

    const result = await pool.query<VehicleRow>(
      `INSERT INTO vehicles (plate_number, make, model, year, color, vehicle_type, fuel_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [plateNumber, make, model, Number(year), color || null, vehicleType || null, fuelType || null],
    );

    res.status(201).json({
      success: true,
      data: mapRow(result.rows[0]),
      message: 'Vehicle created successfully',
    });
  } catch (error) {
    console.error('POST /api/vehicles error:', (error as Error).message);
    res.status(500).json({ success: false, data: null, error: 'Database error' });
  }
});

function mapRow(row: VehicleRow) {
  return {
    id: row.id,
    plateNumber: row.plate_number,
    make: row.make,
    model: row.model,
    year: row.year,
    color: row.color ?? undefined,
    vehicleType: row.vehicle_type ?? undefined,
    fuelType: row.fuel_type ?? undefined,
    underRepair: row.under_repair,
    notes: row.notes ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// PUT /api/vehicles/:id — Update a vehicle
router.put('/:id', async (req: Request, res: Response) => {
  const { plateNumber, make, model, year, color, vehicleType, fuelType, underRepair, notes } = req.body;

  try {
    const pool = getPool();

    // Check duplicate plate excluding current vehicle
    if (plateNumber) {
      const existing = await pool.query<VehicleRow>(
        'SELECT id FROM vehicles WHERE plate_number = $1 AND id != $2',
        [plateNumber, req.params.id],
      );
      if (existing.rows.length > 0) {
        res.status(409).json({
          success: false,
          data: null,
          error: 'A vehicle with this plate number already exists',
        });
        return;
      }
    }

    const result = await pool.query<VehicleRow>(
      `UPDATE vehicles
       SET plate_number = COALESCE($1, plate_number),
           make = COALESCE($2, make),
           model = COALESCE($3, model),
           year = COALESCE($4, year),
           color = COALESCE($5, color),
           vehicle_type = COALESCE($6, vehicle_type),
           fuel_type = COALESCE($7, fuel_type),
           under_repair = COALESCE($8, under_repair),
           notes = COALESCE($9, notes)
       WHERE id = $10
       RETURNING *`,
      [
        plateNumber || null,
        make || null,
        model || null,
        year ? Number(year) : null,
        color ?? null,
        vehicleType ?? null,
        fuelType ?? null,
        underRepair !== undefined ? underRepair : null,
        notes !== undefined ? notes : null,
        req.params.id,
      ],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, data: null, error: 'Vehicle not found' });
      return;
    }

    res.json({
      success: true,
      data: mapRow(result.rows[0]),
      message: 'Vehicle updated successfully',
    });
  } catch (error) {
    console.error('PUT /api/vehicles/:id error:', (error as Error).message);
    res.status(500).json({ success: false, data: null, error: 'Database error' });
  }
});

// PATCH /api/vehicles/:id/repair — Toggle under_repair status with notes
router.patch('/:id/repair', async (req: Request, res: Response) => {
  const { underRepair, notes } = req.body;

  if (underRepair === undefined) {
    res.status(400).json({ success: false, data: null, error: 'underRepair is required' });
    return;
  }

  try {
    const pool = getPool();
    const result = await pool.query<VehicleRow>(
      `UPDATE vehicles SET under_repair = $1, notes = $2 WHERE id = $3 RETURNING *`,
      [underRepair, notes ?? null, req.params.id],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, data: null, error: 'Vehicle not found' });
      return;
    }

    res.json({
      success: true,
      data: mapRow(result.rows[0]),
      message: underRepair ? 'Vehicle marked under repair' : 'Vehicle marked as active',
    });
  } catch (error) {
    console.error('PATCH /api/vehicles/:id/repair error:', (error as Error).message);
    res.status(500).json({ success: false, data: null, error: 'Database error' });
  }
});

// DELETE /api/vehicles/:id — Delete a vehicle
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const result = await pool.query<VehicleRow>(
      'DELETE FROM vehicles WHERE id = $1 RETURNING *',
      [req.params.id],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, data: null, error: 'Vehicle not found' });
      return;
    }

    res.json({
      success: true,
      data: mapRow(result.rows[0]),
      message: 'Vehicle deleted successfully',
    });
  } catch (error) {
    console.error('DELETE /api/vehicles/:id error:', (error as Error).message);
    res.status(500).json({ success: false, data: null, error: 'Database error' });
  }
});

export default router;
