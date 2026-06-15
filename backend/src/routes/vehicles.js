import express from 'express';
import { getPool } from '../db/db.js';
const router = express.Router();
// GET /api/vehicles — List all vehicles
router.get('/', async (_req, res) => {
    try {
        const pool = getPool();
        const result = await pool.query('SELECT * FROM vehicles ORDER BY created_at DESC');
        const data = result.rows.map(mapRow);
        const response = {
            success: true,
            data,
            message: 'Vehicles retrieved successfully',
        };
        res.json(response);
    }
    catch (error) {
        console.error('GET /api/vehicles error:', error.message);
        res.status(500).json({ success: false, data: null, error: 'Database error' });
    }
});
// GET /api/vehicles/:id — Get single vehicle
router.get('/:id', async (req, res) => {
    try {
        const pool = getPool();
        const result = await pool.query('SELECT * FROM vehicles WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) {
            res.status(404).json({ success: false, data: null, error: 'Vehicle not found' });
            return;
        }
        res.json({ success: true, data: mapRow(result.rows[0]) });
    }
    catch (error) {
        console.error('GET /api/vehicles/:id error:', error.message);
        res.status(500).json({ success: false, data: null, error: 'Database error' });
    }
});
// POST /api/vehicles — Create a new vehicle
router.post('/', async (req, res) => {
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
        const existing = await pool.query('SELECT id FROM vehicles WHERE plate_number = $1', [plateNumber]);
        if (existing.rows.length > 0) {
            res.status(409).json({
                success: false,
                data: null,
                error: 'A vehicle with this plate number already exists',
            });
            return;
        }
        const result = await pool.query(`INSERT INTO vehicles (plate_number, make, model, year, color, vehicle_type, fuel_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`, [plateNumber, make, model, Number(year), color || null, vehicleType || null, fuelType || null]);
        res.status(201).json({
            success: true,
            data: mapRow(result.rows[0]),
            message: 'Vehicle created successfully',
        });
    }
    catch (error) {
        console.error('POST /api/vehicles error:', error.message);
        res.status(500).json({ success: false, data: null, error: 'Database error' });
    }
});
function mapRow(row) {
    return {
        id: row.id,
        plateNumber: row.plate_number,
        make: row.make,
        model: row.model,
        year: row.year,
        color: row.color ?? undefined,
        vehicleType: row.vehicle_type ?? undefined,
        fuelType: row.fuel_type ?? undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
export default router;
//# sourceMappingURL=vehicles.js.map