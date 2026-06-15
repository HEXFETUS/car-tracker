import express, { type Request, type Response, type Router as ExpressRouter } from 'express';
import type { ApiResponse } from '@car-tracker/shared';
import { getPool } from '../db/db.js';

const router: ExpressRouter = express.Router();

interface DriverRow {
  id: string;
  full_name: string;
  phone: string;
  email: string;
  address: string | null;
  license_number: string;
  expiry_date: string;
  created_at: string;
  updated_at: string;
}

// GET /api/drivers — List all drivers
router.get('/', async (_req: Request, res: Response) => {
  try {
    const pool = getPool();
    const result = await pool.query<DriverRow>(
      'SELECT * FROM drivers ORDER BY created_at DESC',
    );
    const data = result.rows.map(mapRow);
    res.json({ success: true, data, message: 'Drivers retrieved successfully' });
  } catch (error) {
    console.error('GET /api/drivers error:', (error as Error).message);
    res.status(500).json({ success: false, data: null, error: 'Database error' });
  }
});

// GET /api/drivers/:id — Get single driver
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const result = await pool.query<DriverRow>(
      'SELECT * FROM drivers WHERE id = $1', [req.params.id],
    );
    if (result.rows.length === 0) {
      res.status(404).json({ success: false, data: null, error: 'Driver not found' });
      return;
    }
    res.json({ success: true, data: mapRow(result.rows[0]) });
  } catch (error) {
    console.error('GET /api/drivers/:id error:', (error as Error).message);
    res.status(500).json({ success: false, data: null, error: 'Database error' });
  }
});

// POST /api/drivers — Create a new driver
router.post('/', async (req: Request, res: Response) => {
  const { fullName, phone, email, address, licenseNumber, expiryDate } = req.body;

  if (!fullName || !phone || !email || !licenseNumber || !expiryDate) {
    res.status(400).json({
      success: false,
      data: null,
      error: 'Full Name, Phone, Email, License Number, and Expiry Date are required',
    });
    return;
  }

  try {
    const pool = getPool();

    // Check duplicate license
    const existing = await pool.query<DriverRow>(
      'SELECT id FROM drivers WHERE license_number = $1', [licenseNumber],
    );
    if (existing.rows.length > 0) {
      res.status(409).json({
        success: false,
        data: null,
        error: 'A driver with this license number already exists',
      });
      return;
    }

    const result = await pool.query<DriverRow>(
      `INSERT INTO drivers (full_name, phone, email, address, license_number, expiry_date)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [fullName, phone, email, address || null, licenseNumber, expiryDate],
    );

    res.status(201).json({
      success: true,
      data: mapRow(result.rows[0]),
      message: 'Driver created successfully',
    });
  } catch (error) {
    console.error('POST /api/drivers error:', (error as Error).message);
    res.status(500).json({ success: false, data: null, error: 'Database error' });
  }
});

function mapRow(row: DriverRow) {
  return {
    id: row.id,
    fullName: row.full_name,
    phone: row.phone,
    email: row.email,
    address: row.address ?? undefined,
    licenseNumber: row.license_number,
    expiryDate: row.expiry_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export default router;
