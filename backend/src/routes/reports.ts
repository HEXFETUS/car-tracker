import express, { type Request, type Response, type Router as ExpressRouter } from 'express';
import type { ApiResponse } from '@car-tracker/shared';
import { getPool } from '../db/db.js';
import { haversineDistance } from '../services/gpsLogService.js';
import { mapGpsTripLogRow } from './gps-trip-log-serializer.js';

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
      WITH trip_data AS (
        -- GPS trip logs (trips linked to Travel Orders)
        SELECT
          vehicle_id::text AS vehicle_id,
          gps_distance_km AS distance_km,
          travel_order_id,
          trip_date
        FROM gps_trip_logs
        WHERE EXTRACT(MONTH FROM trip_date) = $1
          AND EXTRACT(YEAR FROM trip_date) = $2

        UNION ALL

        -- GPS no-TO logs (trips without Travel Orders)
        SELECT
          vehicle_id::text AS vehicle_id,
          distance_km,
          NULL::uuid AS travel_order_id,
          trip_date
        FROM gps_no_to_logs
        WHERE EXTRACT(MONTH FROM trip_date) = $1
          AND EXTRACT(YEAR FROM trip_date) = $2
          AND parent_trip_id IS NULL
      ),
      vehicle_agg AS (
        SELECT
          vehicle_id,
          COUNT(*) AS total_gps_trips,
          COALESCE(SUM(distance_km), 0) AS total_gps_distance_km,
          COUNT(*) FILTER (WHERE travel_order_id IS NULL) AS unauthorized_trips,
          COUNT(DISTINCT travel_order_id) FILTER (WHERE travel_order_id IS NOT NULL) AS linked_trips
        FROM trip_data
        GROUP BY vehicle_id
      ),
      approved_tos AS (
        SELECT
          gtl.vehicle_id::text AS vehicle_id,
          COUNT(DISTINCT gtl.travel_order_id) AS total_approved_tos
        FROM gps_trip_logs gtl
        INNER JOIN travel_orders to_ ON to_.id = gtl.travel_order_id
        WHERE to_.status = 'APPROVED'
          AND EXTRACT(MONTH FROM gtl.trip_date) = $1
          AND EXTRACT(YEAR FROM gtl.trip_date) = $2
        GROUP BY gtl.vehicle_id::text
      )
      SELECT
        v.plate_number AS vehicle_plate_no,
        COALESCE(va.total_gps_trips, 0) AS total_gps_trips,
        COALESCE(va.total_gps_distance_km, 0) AS total_gps_distance_km,
        COALESCE(at.total_approved_tos, 0) AS total_approved_tos,
        COALESCE(va.unauthorized_trips, 0) AS unauthorized_trips,
        COALESCE(va.linked_trips, 0) AS linked_trips
      FROM vehicles v
      LEFT JOIN vehicle_agg va ON va.vehicle_id = v.id::text
      LEFT JOIN approved_tos at ON at.vehicle_id = v.id::text
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
      trip_data AS (
        -- GPS trip logs (trips linked to Travel Orders)
        SELECT
          EXTRACT(MONTH FROM trip_date)::int AS month,
          gps_distance_km AS distance_km,
          travel_order_id,
          trip_date
        FROM gps_trip_logs
        WHERE EXTRACT(YEAR FROM trip_date) = $1

        UNION ALL

        -- GPS no-TO logs (trips without Travel Orders)
        SELECT
          EXTRACT(MONTH FROM trip_date)::int AS month,
          distance_km,
          NULL::uuid AS travel_order_id,
          trip_date
        FROM gps_no_to_logs
        WHERE EXTRACT(YEAR FROM trip_date) = $1
          AND parent_trip_id IS NULL
      ),
      gps AS (
        SELECT
          month,
          COUNT(*) AS total_gps_trips,
          COALESCE(SUM(distance_km), 0) AS total_gps_distance_km,
          COUNT(*) FILTER (WHERE travel_order_id IS NULL) AS unauthorized_trips,
          COUNT(DISTINCT travel_order_id) FILTER (WHERE travel_order_id IS NOT NULL) AS linked_trips
        FROM trip_data
        GROUP BY month
      ),
      tos AS (
        SELECT
          EXTRACT(MONTH FROM gtl.trip_date)::int AS month,
          COUNT(DISTINCT gtl.travel_order_id) FILTER (WHERE to_.status = 'APPROVED') AS total_approved_tos
        FROM gps_trip_logs gtl
        INNER JOIN travel_orders to_ ON to_.id = gtl.travel_order_id
        WHERE EXTRACT(YEAR FROM gtl.trip_date) = $1
        GROUP BY EXTRACT(MONTH FROM gtl.trip_date)
      ),
      prev AS (
        SELECT
          EXTRACT(MONTH FROM trip_date)::int AS month,
          COALESCE(SUM(gps_distance_km), 0) AS prev_distance
        FROM gps_trip_logs
        WHERE EXTRACT(YEAR FROM trip_date) = $1 - 1
        GROUP BY EXTRACT(MONTH FROM trip_date)
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
        g.id,
        g.gps_record_no,
        g.trip_date,
        g.origin_gps_start_point,
        g.destination_gps_end_point,
        g.coordinates_origin,
        g.coordinates_destination,
        g.actual_route_road_taken,
        g.gps_distance_km,
        g.engine_hours,
        g.max_speed_kph,
        g.trip_status_gps,
        g.to_status_auto,
        g.anomaly_flag,
        g.notes_remarks,
        g.destination_verified,
        g.trip_type,
        g.parent_trip_id,
        g.departure_time_gps,
        g.arrival_time_gps,
        g.destination_reached_at,
        d.full_name AS driver_full_name,
        to_.to_number AS travel_order_to_number,
        to_.origin_location AS to_origin,
        to_.destination_target AS to_destination
      FROM travel_orders to_
      LEFT JOIN vehicles v ON v.id = to_.vehicle_id
      LEFT JOIN gps_trip_logs g ON g.travel_order_id = to_.id
      LEFT JOIN drivers d ON d.id = COALESCE(g.driver_id, to_.driver_id)
      WHERE to_.status IN ('APPROVED', 'ACTIVE', 'COMPLETED')
      ORDER BY to_.updated_at DESC, g.trip_date DESC NULLS LAST
    `;

    const result = await pool.query(sql);

    // ── Transform rows with variance calculation ──────────────────
    const data = result.rows.map((row: any) => {
      const gpsLog = row.id ? mapGpsTripLogRow(row) : null;
      // TO estimated mileage: from origin/destination coordinates via haversine.
      // This is one-way distance; multiply by 2 for round-trip (origin → destination → origin).
      let toEstOneWayKm = 0;
      if (row.lat_long_origin && row.lat_long_destination) {
        const distMeters = haversineDistance(row.lat_long_origin, row.lat_long_destination);
        toEstOneWayKm = parseFloat((distMeters / 1000).toFixed(1));
      }
      const toEstMileageKm = parseFloat((toEstOneWayKm * 2).toFixed(1));

      const gpsActualMileageKm = row.gps_distance_km != null
        ? parseFloat(String(row.gps_distance_km))
        : 0;

      // Variance uses round-trip TO estimate
      const varianceKm = parseFloat((gpsActualMileageKm - toEstMileageKm).toFixed(1));
      const variancePct = toEstMileageKm > 0
        ? parseFloat(((varianceKm / toEstMileageKm) * 100).toFixed(1))
        : 0;

      // Determine match status per specification rules
      // Order is important: MISSING TO DISTANCE takes priority, then NO GPS RECORD
      let status: 'Matched' | 'Flagged' | 'NO GPS RECORD' | 'MISSING TO DISTANCE';
      if (toEstMileageKm === 0) {
        status = 'MISSING TO DISTANCE';
      } else if (row.id == null) {
        status = 'NO GPS RECORD';
      } else if (variancePct <= 20) {
        status = 'Matched';
      } else {
        status = 'Flagged';
      }

      return {
        id: row.travel_order_id,
        toNo: row.to_number || '—',
        gpsRecordNo: gpsLog?.gpsRecordNo || (row.id ? `GPS-${row.to_number ?? 'UNKNOWN'}` : '—'),
        vehiclePlate: row.plate_number || 'Unknown',
        tripDate: row.departure_time_gps ?? null,
        origin: gpsLog?.originGpsStartPoint || '—',
        destination: row.destination_target || '—',
        gpsActualDestination: gpsLog?.destinationGpsEndPoint || null,
        departureTime: gpsLog?.departureTimeGps ?? null,
        toEstMileageKm,
        gpsActualMileageKm,
        varianceKm,
        variancePct,
        status,
        explanationRemarks: '',
        toStatus: row.to_status || '',
        // Use destination_reached_at (GPS actual destination arrival time) as primary,
        // fall back to arrival_time_gps (which may be the return/end time).
        arrivalTime: row.destination_reached_at ?? gpsLog?.arrivalTimeGps ?? null,
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
