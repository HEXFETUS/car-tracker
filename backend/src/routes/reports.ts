import express, { type Request, type Response, type Router as ExpressRouter } from 'express';
import type { ApiResponse } from '@car-tracker/shared';
import { getPool } from '../db/db.js';
import { haversineDistance } from '../services/gpsLogService.js';

const router: ExpressRouter = express.Router();

interface ReconciliationRow {
  id: string;
  to_number: string;
  gps_record_no: string;
  plate_number: string;
  trip_date: string;
  to_status: string;
  to_origin: string | null;
  to_destination: string | null;
  gps_origin: string | null;
  gps_destination: string | null;
  gps_distance_km: number | null;
  lat_long_origin: string | null;
  lat_long_destination: string | null;
}

// GET /api/reports/reconciliation — Match GPS trip logs with travel orders
router.get('/reconciliation', async (_req: Request, res: Response) => {
  try {
    const pool = getPool();

    const result = await pool.query(`
      WITH arrival_times AS (
        SELECT
          g.id as log_id,
          MIN(t.recorded_at) as arrival_time_gps
        FROM gps_trip_logs g
        JOIN travel_orders t_o ON t_o.id = g.travel_order_id
        JOIN gps_telemetry t
          ON t.vehicle_id = g.vehicle_id
          AND DATE(t.recorded_at) = g.trip_date
          AND t_o.lat_long_destination IS NOT NULL
        WHERE g.departure_time_gps IS NOT NULL
          AND g.travel_order_id IS NOT NULL
          AND t_o.status IN ('APPROVED', 'ACTIVE', 'COMPLETED')
          AND (
            SELECT haversine_distance(t_o.lat_long_destination, CONCAT(t.latitude, ',', t.longitude)) / 1000.0
          ) <= 0.2
        GROUP BY g.id
      )
      SELECT
        g.id,
        t_o.to_number,
        t_o.status AS to_status,
        g.gps_record_no,
        v.plate_number,
        g.trip_date,
        t_o.origin_location AS to_origin,
        t_o.destination_target AS to_destination,
        g.origin_gps_start_point AS gps_origin,
        g.destination_gps_end_point AS gps_destination,
        g.gps_distance_km,
        t_o.lat_long_origin,
        t_o.lat_long_destination,
        COALESCE(at.arrival_time_gps, g.arrival_time_gps) as arrival_time_gps
      FROM gps_trip_logs g
      LEFT JOIN travel_orders t_o ON t_o.id = g.travel_order_id
      LEFT JOIN vehicles v ON v.id = g.vehicle_id
      LEFT JOIN arrival_times at ON at.log_id = g.id
      WHERE g.departure_time_gps IS NOT NULL
        AND g.travel_order_id IS NOT NULL
        AND t_o.status IN ('APPROVED', 'ACTIVE', 'COMPLETED')
      ORDER BY g.trip_date DESC, g.created_at DESC
    `);

    const data = result.rows.map((row: any) => {
      const gpsActualMileageKm = parseFloat(String(row.gps_distance_km ?? 0));

      // Calculate TO estimated mileage from origin/destination coordinates
      let toEstMileageKm = 0;
      if (row.lat_long_origin && row.lat_long_destination) {
        const distMeters = haversineDistance(row.lat_long_origin, row.lat_long_destination);
        toEstMileageKm = distMeters / 1000; // Convert meters to kilometers
      } else if (row.to_origin && row.to_destination) {
        // Fallback: if no coordinates, use a rough estimate based on GPS distance
        // In production, you'd want to integrate a routing service here
        toEstMileageKm = gpsActualMileageKm;
      }

      const varianceKm = toEstMileageKm - gpsActualMileageKm;
      const variancePct = toEstMileageKm > 0 ? (varianceKm / toEstMileageKm) * 100 : 0;
      const status: 'Matched' | 'Flagged' = Math.abs(variancePct) <= 20 ? 'Matched' : 'Flagged';

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

    res.json({ success: true, data, message: 'Reconciliation data retrieved successfully' });
  } catch (error) {
    console.error('GET /api/reports/reconciliation error:', (error as Error).message);
    res.status(500).json({ success: false, data: null, error: 'Database error' });
  }
});

export default router;