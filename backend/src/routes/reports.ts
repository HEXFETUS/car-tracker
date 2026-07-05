import express, { type Request, type Response, type Router as ExpressRouter } from 'express';
import type { ApiResponse } from '@car-tracker/shared';
import { getPool } from '../db/db.js';
import { haversineDistance } from '../services/gpsLogService.js';

const router: ExpressRouter = express.Router();

// GET /api/reports/reconciliation — Match Travel Orders with GPS trip history
// Starts from travel_orders so that ALL relevant orders appear, even without GPS logs.
// Only APPROVED, ACTIVE, and COMPLETED orders are included.
// GET /api/reports/monthly — Per-vehicle monthly summary
router.get('/monthly', async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const month = parseInt(req.query.month as string, 10);
    const year = parseInt(req.query.year as string, 10);

    if (!month || !year || month < 1 || month > 12 || year < 2000 || year > 2100) {
      res.status(400).json({ success: false, data: null, error: 'Valid month (1-12) and year are required' });
      return;
    }

    const sql = `
      WITH gps AS (
        SELECT
          vehicle_id::text AS vehicle_id,
          COUNT(*) AS total_gps_trips,
          COALESCE(SUM(gps_distance_km), 0) AS total_gps_distance_km,
          COUNT(*) FILTER (
            WHERE travel_order_id IS NULL
               OR to_status_auto = 'NO_APPROVED_TO'
          ) AS unauthorized_trips,
          COUNT(*) FILTER (
            WHERE travel_order_id IS NOT NULL
          ) AS linked_trips
        FROM gps_trip_logs
        WHERE EXTRACT(MONTH FROM COALESCE(departure_time_gps, created_at)) = $1
          AND EXTRACT(YEAR FROM COALESCE(departure_time_gps, created_at)) = $2
        GROUP BY vehicle_id::text
      ),
      tos AS (
        SELECT
          vehicle_id::text AS vehicle_id,
          COUNT(*) FILTER (
            WHERE status IN ('APPROVED', 'ACTIVE', 'COMPLETED')
          ) AS total_approved_tos
        FROM travel_orders
        WHERE EXTRACT(MONTH FROM COALESCE(scheduled_departure, created_at)) = $1
          AND EXTRACT(YEAR FROM COALESCE(scheduled_departure, created_at)) = $2
        GROUP BY vehicle_id::text
      )
      SELECT
        v.plate_number AS vehicle_plate_no,
        COALESCE(g.total_gps_trips, 0) AS total_gps_trips,
        COALESCE(g.total_gps_distance_km, 0) AS total_gps_distance_km,
        COALESCE(t.total_approved_tos, 0) AS total_approved_tos,
        COALESCE(g.unauthorized_trips, 0) AS unauthorized_trips,
        COALESCE(g.linked_trips, 0) AS linked_trips
      FROM vehicles v
      LEFT JOIN gps g ON g.vehicle_id = v.id::text
      LEFT JOIN tos t ON t.vehicle_id = v.id::text
      ORDER BY v.plate_number;
    `;

    const result = await pool.query(sql, [month, year]);

    const rows = result.rows.map((row: any) => {
      const totalGpsTrips = Number(row.total_gps_trips ?? 0);
      const totalGpsDistanceKm = Number(row.total_gps_distance_km ?? 0);
      const totalApprovedTOs = Number(row.total_approved_tos ?? 0);
      const unauthorizedTrips = Number(row.unauthorized_trips ?? 0);
      const linkedTrips = Number(row.linked_trips ?? 0);

      let remarks = '—';
      if (unauthorizedTrips > 0) {
        remarks = `${unauthorizedTrips} unauthorized trip(s)`;
      } else if (totalGpsTrips > totalApprovedTOs && totalApprovedTOs > 0) {
        remarks = 'GPS trips exceed approved TOs';
      } else if (totalApprovedTOs > 0 && totalGpsTrips === 0) {
        remarks = 'No GPS trips';
      }

      return {
        vehiclePlateNo: row.vehicle_plate_no,
        totalGpsTrips,
        totalGpsDistanceKm: parseFloat(totalGpsDistanceKm.toFixed(2)),
        totalApprovedTOs,
        unauthorizedTrips,
        linkedTrips,
        remarks,
      };
    });

    res.json({ success: true, data: rows, message: 'Monthly report data retrieved successfully' });
  } catch (error) {
    console.error('GET /api/reports/monthly error:', (error as Error).message);
    res.status(500).json({ success: false, data: null, error: 'Database error' });
  }
});

// GET /api/reports/yearly — Full-year aggregated monthly report
router.get('/yearly', async (req: Request, res: Response) => {
  try {
    const pool = getPool();
    const year = parseInt(req.query.year as string, 10);

    if (!year || year < 2000 || year > 2100) {
      res.status(400).json({ success: false, data: null, error: 'Valid year is required' });
      return;
    }

    const sql = `
      WITH months AS (
        SELECT generate_series(1, 12) AS month
      ),
      gps AS (
        SELECT
          EXTRACT(MONTH FROM COALESCE(departure_time_gps, created_at))::int AS month,
          COUNT(*) AS total_gps_trips,
          COALESCE(SUM(gps_distance_km), 0) AS total_gps_distance_km,
          COUNT(*) FILTER (
            WHERE travel_order_id IS NULL
               OR to_status_auto = 'NO_APPROVED_TO'
          ) AS unauthorized_trips,
          COUNT(*) FILTER (
            WHERE travel_order_id IS NOT NULL
          ) AS linked_trips
        FROM gps_trip_logs
        WHERE EXTRACT(YEAR FROM COALESCE(departure_time_gps, created_at)) = $1
        GROUP BY EXTRACT(MONTH FROM COALESCE(departure_time_gps, created_at))
      ),
      tos AS (
        SELECT
          EXTRACT(MONTH FROM COALESCE(scheduled_departure, created_at))::int AS month,
          COUNT(*) FILTER (
            WHERE status IN ('APPROVED', 'ACTIVE', 'COMPLETED')
          ) AS total_approved_tos
        FROM travel_orders
        WHERE EXTRACT(YEAR FROM COALESCE(scheduled_departure, created_at)) = $1
        GROUP BY EXTRACT(MONTH FROM COALESCE(scheduled_departure, created_at))
      ),
      prev AS (
        SELECT
          EXTRACT(MONTH FROM COALESCE(departure_time_gps, created_at))::int AS month,
          COALESCE(SUM(gps_distance_km), 0) AS prev_distance
        FROM gps_trip_logs
        WHERE EXTRACT(YEAR FROM COALESCE(departure_time_gps, created_at)) = $1 - 1
        GROUP BY EXTRACT(MONTH FROM COALESCE(departure_time_gps, created_at))
      )
      SELECT
        m.month,
        COALESCE(g.total_gps_trips, 0)::numeric AS total_gps_trips,
        COALESCE(g.total_gps_distance_km, 0)::numeric AS total_gps_distance_km,
        COALESCE(t.total_approved_tos, 0)::numeric AS total_approved_tos,
        COALESCE(g.unauthorized_trips, 0)::numeric AS unauthorized_trips,
        COALESCE(g.linked_trips, 0)::numeric AS linked_trips,
        p.prev_distance
      FROM months m
      LEFT JOIN gps g ON g.month = m.month
      LEFT JOIN tos t ON t.month = m.month
      LEFT JOIN prev p ON p.month = m.month
      ORDER BY m.month;
    `;

    const result = await pool.query(sql, [year]);
    const MONTH_LABELS = [
      'Jan','Feb','Mar','Apr','May','Jun',
      'Jul','Aug','Sep','Oct','Nov','Dec'
    ];

    const months = result.rows.map((row: any) => {
      const totalGpsTrips = Number(row.total_gps_trips ?? 0);
      const totalGpsDistanceKm = Number(row.total_gps_distance_km ?? 0);
      const totalApprovedTOs = Number(row.total_approved_tos ?? 0);
      const unauthorizedTrips = Number(row.unauthorized_trips ?? 0);
      const linkedTOs = Number(row.linked_trips ?? 0);
      const prevDistance = Number(row.prev_distance ?? 0);

      const varianceIssues = Math.abs(totalGpsTrips - totalApprovedTOs);
      const approvalRate = totalGpsTrips > 0 ? (linkedTOs / totalGpsTrips) * 100 : 0;
      const avgTripDistanceKm = totalGpsTrips > 0 ? totalGpsDistanceKm / totalGpsTrips : 0;
      const vsPreviousPercent = prevDistance > 0
        ? ((totalGpsDistanceKm - prevDistance) / prevDistance) * 100
        : null;

      return {
        month: row.month,
        monthLabel: MONTH_LABELS[row.month - 1] || String(row.month),
        totalGpsTrips,
        totalGpsDistanceKm,
        totalApprovedTOs,
        unauthorizedTrips,
        varianceIssues,
        approvalRate,
        avgTripDistanceKm,
        vsPreviousPercent,
      };
    });

    const summary = (() => {
      const annualDistanceKm = months.reduce((s, m) => s + m.totalGpsDistanceKm, 0);
      const annualTrips = months.reduce((s, m) => s + m.totalGpsTrips, 0);
      const approvedTOs = months.reduce((s, m) => s + m.totalApprovedTOs, 0);
      const unauthorizedTrips = months.reduce((s, m) => s + m.unauthorizedTrips, 0);
      const varianceIssuesTotal = months.reduce((s, m) => s + m.varianceIssues, 0);
      const avgMonthlyDistanceKm = annualDistanceKm / 12 || 0;
      const avgTripsPerMonth = annualTrips / 12 || 0;
      const avgTOsPerMonth = approvedTOs / 12 || 0;
      const approvalRate = annualTrips > 0
        ? (months.reduce((s, m) => s + (m.totalGpsTrips > 0 ? (m.totalApprovedTOs / m.totalGpsTrips) * 100 : 0), 0))
        : 0;
      return {
        annualDistanceKm,
        annualTrips,
        approvedTOs,
        unauthorizedTrips,
        varianceIssues: varianceIssuesTotal,
        avgMonthlyDistanceKm,
        avgTripsPerMonth,
        avgTOsPerMonth,
        approvalRate,
      };
    })();

    res.json({ success: true, data: { year, months, summary } });
  } catch (error) {
    console.error('GET /api/reports/yearly error:', (error as Error).message);
    res.status(500).json({ success: false, data: null, error: 'Database error' });
  }
});

// Existing endpoint
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