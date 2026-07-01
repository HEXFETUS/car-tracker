import express, { type Request, type Response, type Router as ExpressRouter } from 'express';
import type { ApiResponse } from '@car-tracker/shared';
import { getPool } from '../db/db.js';
import { haversineDistance } from '../services/gpsLogService.js';

const router: ExpressRouter = express.Router();

// GET /api/reports/reconciliation — Match Travel Orders with GPS trip history
// Starts from travel_orders so that ALL relevant orders appear, even without GPS logs.
// Only APPROVED, ACTIVE, and COMPLETED orders are included.
router.get('/reconciliation', async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const statusFilter = req.query.status as string | undefined;

    // Query: start from travel_orders, LEFT JOIN GPS trip logs
    const sql = `
      SELECT
        to_.id                                                       AS travel_order_id,
        to_.to_number,
        to_.status                                                   AS to_status,
        to_.origin_location,
        to_.destination_target,
        to_.lat_long_origin,
        to_.lat_long_destination,
        v.plate_number,
        g.id                                                         AS gps_log_id,
        g.gps_record_no,
        g.trip_date,
        g.origin_gps_start_point                                     AS gps_origin,
        g.destination_gps_end_point                                  AS gps_destination,
        g.gps_distance_km,
        g.departure_time_gps,
        g.arrival_time_gps
      FROM travel_orders to_
      LEFT JOIN vehicles v ON v.id = to_.vehicle_id
      LEFT JOIN gps_trip_logs g ON g.travel_order_id = to_.id
      WHERE to_.status IN ('APPROVED', 'ACTIVE', 'COMPLETED')
      ORDER BY to_.updated_at DESC, g.trip_date DESC NULLS LAST
    `;

    const result = await pool.query(sql);

    // ── Transform rows with variance calculation ──────────────────
    const data = result.rows.map((row: any) => {
      // TO estimated mileage: from origin/destination coordinates via haversine
      let toEstMileageKm = 0;
      if (row.lat_long_origin && row.lat_long_destination) {
        const distMeters = haversineDistance(row.lat_long_origin, row.lat_long_destination);
        toEstMileageKm = parseFloat((distMeters / 1000).toFixed(1));
      }

      const gpsActualMileageKm = row.gps_distance_km != null
        ? parseFloat(String(row.gps_distance_km))
        : 0;

      const varianceKm = parseFloat((gpsActualMileageKm - toEstMileageKm).toFixed(1));
      const variancePct = toEstMileageKm > 0
        ? parseFloat(((Math.abs(varianceKm) / toEstMileageKm) * 100).toFixed(1))
        : 0;

      // Determine match status per specification rules
      // Order is important: MISSING TO DISTANCE takes priority, then NO GPS RECORD
      let status: 'Matched' | 'Flagged' | 'NO GPS RECORD' | 'MISSING TO DISTANCE';
      if (toEstMileageKm === 0) {
        status = 'MISSING TO DISTANCE';
      } else if (row.gps_log_id == null) {
        status = 'NO GPS RECORD';
      } else if (variancePct <= 20) {
        status = 'Matched';
      } else {
        status = 'Flagged';
      }

      return {
        id: row.travel_order_id,
        toNo: row.to_number || '—',
        gpsRecordNo: row.gps_record_no || (row.gps_log_id ? `GPS-${row.to_number ?? 'UNKNOWN'}` : '—'),
        vehiclePlate: row.plate_number || 'Unknown',
        tripDate: row.trip_date
          ? new Date(row.trip_date).toISOString().split('T')[0]
          : '—',
        origin: row.gps_origin || row.origin_location || '—',
        destination: row.gps_destination || row.destination_target || '—',
        toEstMileageKm,
        gpsActualMileageKm,
        varianceKm,
        variancePct,
        status,
        explanationRemarks: '',
        toStatus: row.to_status || '',
        arrivalTime: row.arrival_time_gps
          ? new Date(row.arrival_time_gps).toLocaleString('en-US', {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            })
          : null,
      };
    });

    // ── Apply status filter if provided ───────────────────────────
    let filtered = data;
    if (statusFilter) {
      filtered = data.filter((r: any) => r.status === statusFilter);
    }

    res.json({ success: true, data: filtered, message: 'Reconciliation data retrieved successfully' });
  } catch (error) {
    console.error('GET /api/reports/reconciliation error:', (error as Error).message);
    res.status(500).json({ success: false, data: null, error: 'Database error' });
  }
});

export default router;