import express, { type Request, type Response, type Router as ExpressRouter } from 'express';
import type { ApiResponse } from '@car-tracker/shared';
import { getPool } from '../db/db.js';

const router: ExpressRouter = express.Router();

interface ReconciliationRow {
  id: string;
  to_number: string;
  gps_record_no: string;
  plate_number: string;
  trip_date: string;
  to_origin: string | null;
  to_destination: string | null;
  gps_origin: string | null;
  gps_destination: string | null;
  gps_distance_km: number | null;
}

// GET /api/reports/reconciliation — Match GPS trip logs with travel orders
router.get('/reconciliation', async (_req: Request, res: Response) => {
  try {
    const pool = getPool();

    const result = await pool.query<ReconciliationRow>(`
      SELECT
        g.id,
        t_o.to_number,
        g.gps_record_no,
        v.plate_number,
        g.trip_date,
        t_o.origin_location AS to_origin,
        t_o.destination_target AS to_destination,
        g.origin_gps_start_point AS gps_origin,
        g.destination_gps_end_point AS gps_destination,
        g.gps_distance_km
      FROM gps_trip_logs g
      LEFT JOIN travel_orders t_o ON t_o.id = g.travel_order_id
      LEFT JOIN vehicles v ON v.id = g.vehicle_id
      WHERE g.departure_time_gps IS NOT NULL
        AND g.travel_order_id IS NOT NULL
      ORDER BY g.trip_date DESC, g.created_at DESC
    `);

    const data = result.rows.map((row) => {
      const toEstMileageKm = parseFloat(String(row.gps_distance_km ?? 0));
      const gpsActualMileageKm = parseFloat(String(row.gps_distance_km ?? 0));
      const varianceKm = 0;
      const variancePct = 0;
      const status: 'Matched' | 'Flagged' = 'Matched';

      return {
        id: row.id,
        toNo: row.to_number || '—',
        gpsRecordNo: row.gps_record_no,
        vehiclePlate: row.plate_number || 'Unknown',
        tripDate: row.trip_date,
        origin: row.gps_origin || row.to_origin || '—',
        destination: row.gps_destination || row.to_destination || '—',
        toEstMileageKm,
        gpsActualMileageKm,
        varianceKm,
        variancePct,
        status,
        explanationRemarks: '',
      };
    });

    res.json({ success: true, data, message: 'Reconciliation data retrieved successfully' });
  } catch (error) {
    console.error('GET /api/reports/reconciliation error:', (error as Error).message);
    res.status(500).json({ success: false, data: null, error: 'Database error' });
  }
});

export default router;