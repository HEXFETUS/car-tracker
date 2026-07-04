import express, { type Request, type Response, type Router as ExpressRouter } from 'express';
import { getPool } from '../db/db.js';

const router: ExpressRouter = express.Router();

// GET /api/dashboard — Aggregated dashboard data
router.get('/', async (_req: Request, res: Response) => {
  let dashboardStep = 'initializing';
  try {
    const pool = getPool();

    // ── Row 1: Executive Summary KPIs ──────────────────────────
    dashboardStep = 'fleet KPIs';
    const fleetKpis = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM vehicles) AS total_vehicles,
        (SELECT COUNT(*) FROM vehicles WHERE under_repair = FALSE) AS available_vehicles,
        (SELECT COUNT(*) FROM travel_orders WHERE status = 'ACTIVE') AS active_trips,
        (SELECT COUNT(*) FROM vehicles WHERE under_repair = TRUE) AS vehicles_under_repair,
        (SELECT COUNT(*) FROM maintenance WHERE date >= CURRENT_DATE - INTERVAL '30 days') AS maintenance_due,
        (SELECT COUNT(*) FROM drivers) AS total_drivers
    `);

    // ── Row 2: Travel Orders KPIs ──────────────────────────────
    dashboardStep = 'travel order KPIs';
    const travelOrderKpis = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM travel_orders WHERE status = 'PENDING') AS pending_approval,
        (SELECT COUNT(*) FROM travel_orders WHERE status = 'APPROVED') AS approved,
        (SELECT COUNT(*) FROM travel_orders WHERE status = 'ACTIVE') AS active_travel_orders,
        (SELECT COUNT(*) FROM travel_orders WHERE status = 'COMPLETED' AND DATE(updated_at) = CURRENT_DATE) AS completed_today,
        (SELECT COUNT(*) FROM travel_orders WHERE status = 'CANCELLED') AS cancelled_orders
    `);

    // ── Row 3: GPS Tracking KPIs ──────────────────────────────
    dashboardStep = 'GPS KPIs';
    const gpsKpis = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM gps_trip_logs WHERE trip_date = CURRENT_DATE) AS trips_recorded_today,
        (SELECT COALESCE(SUM(gps_distance_km), 0) FROM gps_trip_logs WHERE trip_date = CURRENT_DATE) AS total_distance_today,
        (SELECT COALESCE(AVG(gps_distance_km), 0) FROM gps_trip_logs WHERE trip_date = CURRENT_DATE) AS avg_distance_per_trip,
        (SELECT COALESCE(MAX(max_speed_kph), 0) FROM gps_trip_logs WHERE trip_date = CURRENT_DATE) AS max_speed_today,
        (SELECT COUNT(*) FROM gps_trip_logs WHERE anomaly_flag = TRUE AND trip_date >= CURRENT_DATE - INTERVAL '7 days') AS gps_anomalies_detected
    `);

    // ── Row 4: Alert Counts ────────────────────────────────────
    dashboardStep = 'alert counts';
    const alertCounts = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM gps_alerts WHERE alert_type = 'IGNITION_ON' AND DATE(created_at) = CURRENT_DATE) AS ignition_on_alerts,
        (SELECT COUNT(*) FROM gps_alerts WHERE alert_type = 'IGNITION_OFF' AND DATE(created_at) = CURRENT_DATE) AS ignition_off_alerts,
        (SELECT COUNT(*) FROM gps_alerts WHERE alert_type = 'IDLING' AND DATE(created_at) = CURRENT_DATE) AS idling_alerts,
        (SELECT COUNT(*) FROM gps_alerts WHERE DATE(created_at) = CURRENT_DATE) AS active_gps_alerts
    `);

    // ── Row 2: Vehicle Status Distribution (Doughnut) ───────────
    // Infer status: assigned if has active/approved travel order
    dashboardStep = 'vehicle status distribution';
    const vehicleStatusDistribution = await pool.query(`
      WITH vehicle_status AS (
        SELECT
          v.id,
          v.plate_number,
          v.under_repair,
          CASE
            WHEN v.under_repair = TRUE THEN 'Under Repair'
            WHEN EXISTS (
              SELECT 1 FROM travel_orders to_
              WHERE to_.vehicle_id = v.id
                AND to_.status IN ('ACTIVE', 'APPROVED', 'FOR_APPROVAL')
            ) THEN 'Assigned'
            WHEN EXISTS (
              SELECT 1 FROM maintenance m WHERE m.vehicle_id = v.id
                AND m.date >= CURRENT_DATE - INTERVAL '90 days'
            ) THEN 'Maintenance'
            ELSE 'Available'
          END AS status_category
        FROM vehicles v
      )
      SELECT status_category AS name, COUNT(*) AS value
      FROM vehicle_status
      GROUP BY status_category
      ORDER BY value DESC
    `);

    // ── Row 3: Travel Orders by Status (Bar Chart) ─────────────
    dashboardStep = 'travel orders by status';
    const travelOrdersByStatus = await pool.query(`
      SELECT
        CASE status
          WHEN 'PENDING' THEN 'Pending'
          WHEN 'FOR_REQUEST' THEN 'For Request'
          WHEN 'FOR_APPROVAL' THEN 'For Approval'
          WHEN 'APPROVED' THEN 'Approved'
          WHEN 'ACTIVE' THEN 'Active'
          WHEN 'COMPLETED' THEN 'Completed'
          WHEN 'CANCELLED' THEN 'Cancelled'
          ELSE status
        END AS name,
        COUNT(*) AS value
      FROM travel_orders
      GROUP BY status
      ORDER BY
        CASE status
          WHEN 'PENDING' THEN 1
          WHEN 'FOR_APPROVAL' THEN 2
          WHEN 'APPROVED' THEN 3
          WHEN 'ACTIVE' THEN 4
          WHEN 'COMPLETED' THEN 5
          WHEN 'CANCELLED' THEN 6
          ELSE 7
        END
    `);

    // ── Row 4: Distance Traveled Last 30 Days (Line Chart) ─────
    dashboardStep = 'distance last 30 days';
    const distanceLast30Days = await pool.query(`
      SELECT
        trip_date AS date,
        COALESCE(SUM(gps_distance_km), 0) AS total_distance
      FROM gps_trip_logs
      WHERE trip_date >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY trip_date
      ORDER BY trip_date ASC
    `);

    // ── Row 4: Trips Per Day Last 30 Days (Area Chart) ─────────
    dashboardStep = 'trips per day';
    const tripsPerDay = await pool.query(`
      SELECT
        trip_date AS date,
        COUNT(*) AS trips
      FROM gps_trip_logs
      WHERE trip_date >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY trip_date
      ORDER BY trip_date ASC
    `);

    // ── Row 5: Live Vehicle Monitoring ──────────────────────────
    dashboardStep = 'live vehicle monitoring';
    const liveMonitoring = await pool.query(`
      SELECT
        v.id AS vehicle_id,
        v.plate_number,
        COALESCE(d.full_name, 'Unassigned') AS driver_name,
        to_.to_number AS current_travel_order,
        to_.id AS current_travel_order_id,
        to_.origin_location AS origin,
        to_.destination_target AS destination,
        to_.scheduled_departure AS departure_time,
        to_.scheduled_arrival AS arrival_time,
        to_.status AS trip_status,
        COALESCE((
          SELECT SUM(gps_distance_km) FROM gps_trip_logs
          WHERE vehicle_id = v.id AND travel_order_id = to_.id
        ), 0) AS distance_traveled,
        (
          SELECT t.latitude FROM gps_telemetry t
          WHERE t.vehicle_id = v.id
          ORDER BY t.recorded_at DESC
          LIMIT 1
        ) AS latitude,
        (
          SELECT t.longitude FROM gps_telemetry t
          WHERE t.vehicle_id = v.id
          ORDER BY t.recorded_at DESC
          LIMIT 1
        ) AS longitude,
        (
          SELECT t.recorded_at FROM gps_telemetry t
          WHERE t.vehicle_id = v.id
          ORDER BY t.recorded_at DESC
          LIMIT 1
        ) AS last_seen
      FROM vehicles v
      LEFT JOIN LATERAL (
        SELECT * FROM travel_orders
        WHERE vehicle_id = v.id
          AND status IN ('ACTIVE', 'APPROVED')
        ORDER BY created_at DESC
        LIMIT 1
      ) to_ ON TRUE
      LEFT JOIN drivers d ON d.id = to_.driver_id
      WHERE to_.id IS NOT NULL
      ORDER BY to_.scheduled_departure DESC
      LIMIT 50
    `);

    // ── Row 6: Recent GPS Alerts ───────────────────────────────
    dashboardStep = 'recent GPS alerts';
    const recentAlerts = await pool.query(`
      SELECT
        a.id,
        a.created_at AS time,
        v.plate_number AS vehicle,
        a.alert_type,
        a.alert_message,
        CONCAT(
          COALESCE(a.latitude::text, 'N/A'), ', ', COALESCE(a.longitude::text, 'N/A')
        ) AS location,
        a.gps_log_id AS gps_record_no
      FROM gps_alerts a
      LEFT JOIN vehicles v ON v.id = a.vehicle_id
      ORDER BY a.created_at DESC
      LIMIT 50
    `);

    // ── Row 7: Driver Performance Leaderboard ──────────────────
    dashboardStep = 'driver performance leaderboard';
    const driverLeaderboard = await pool.query(`
      SELECT
        d.id AS driver_id,
        d.full_name AS driver_name,
        COUNT(DISTINCT g.id) AS total_trips,
        COALESCE(SUM(g.gps_distance_km), 0) AS total_distance,
        COALESCE(AVG(g.max_speed_kph), 0) AS avg_speed,
        COUNT(DISTINCT CASE WHEN to_.status = 'COMPLETED' THEN to_.id END) AS on_time_arrivals,
        COUNT(DISTINCT CASE WHEN g.anomaly_flag = TRUE THEN g.id END) AS gps_violations
      FROM drivers d
      LEFT JOIN gps_trip_logs g ON g.driver_id = d.id
      LEFT JOIN travel_orders to_ ON to_.driver_id = d.id
      GROUP BY d.id, d.full_name
      ORDER BY total_trips DESC
      LIMIT 20
    `);

    // ── Row 8: Maintenance Overview ────────────────────────────
    dashboardStep = 'maintenance overview';
    const maintenanceOverview = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM maintenance WHERE date >= CURRENT_DATE) AS scheduled_maintenance,
        (SELECT COUNT(*) FROM maintenance WHERE date < CURRENT_DATE AND date >= CURRENT_DATE - INTERVAL '90 days') AS overdue_maintenance,
        (SELECT COUNT(*) FROM maintenance WHERE date >= DATE_TRUNC('month', CURRENT_DATE)) AS maintenance_this_month,
        (SELECT COALESCE(SUM(cost), 0) FROM maintenance WHERE date >= DATE_TRUNC('month', CURRENT_DATE)) AS maintenance_cost
    `);

    dashboardStep = 'maintenance trends';
    const maintenanceTrends = await pool.query(`
      SELECT
        TO_CHAR(DATE_TRUNC('month', date), 'YYYY-MM') AS month,
        COUNT(*) AS count,
        COALESCE(SUM(cost), 0) AS total_cost
      FROM maintenance
      WHERE date >= CURRENT_DATE - INTERVAL '12 months'
      GROUP BY DATE_TRUNC('month', date)
      ORDER BY month ASC
    `);

    // ── Admin: Travel Order Matching Accuracy ──────────────────
    dashboardStep = 'travel order matching accuracy';
    const matchingAccuracy = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM gps_trip_logs WHERE travel_order_id IS NOT NULL) AS gps_logs_linked_to_to,
        (SELECT COUNT(*) FROM gps_trip_logs WHERE travel_order_id IS NULL) AS gps_logs_without_to,
        (SELECT COUNT(*) FROM gps_trip_logs WHERE to_status_auto = 'matched') AS auto_matched_trips,
        (SELECT COUNT(*) FROM gps_trip_logs WHERE to_status_auto = 'manual') AS manual_corrections
    `);

    // ── Admin: Fleet Utilization ───────────────────────────────
    dashboardStep = 'total vehicle count';
    const totalVehicles = (await pool.query(`SELECT COUNT(*) AS cnt FROM vehicles`)).rows[0].cnt;
    dashboardStep = 'fleet utilization';
    const fleetUtilization = await pool.query(`
      WITH daily_active AS (
        SELECT
          DATE(recorded_at) AS date,
          COUNT(DISTINCT vehicle_id) AS active_vehicles
        FROM gps_telemetry
        WHERE recorded_at >= CURRENT_DATE - INTERVAL '90 days'
        GROUP BY DATE(recorded_at)
      )
      SELECT
        COALESCE((SELECT active_vehicles FROM daily_active WHERE date = CURRENT_DATE), 0)
          / $1::numeric * 100 AS daily_utilization,
        COALESCE(AVG(active_vehicles), 0) / $1::numeric * 100 AS weekly_utilization,
        COALESCE(AVG(active_vehicles), 0) / $1::numeric * 100 AS monthly_utilization
      FROM daily_active
      WHERE date >= CURRENT_DATE - INTERVAL '30 days'
    `, [totalVehicles]);

    // ── Real-Time: Currently Moving / Idling ───────────────────
    dashboardStep = 'real-time vehicle status';
    const realTimeStatus = await pool.query(`
      WITH latest_telemetry AS (
        SELECT DISTINCT ON (vehicle_id)
          vehicle_id,
          speed_kmh,
          ignition,
          recorded_at
        FROM gps_telemetry
        ORDER BY vehicle_id, recorded_at DESC
      )
      SELECT
        COUNT(*) FILTER (WHERE speed_kmh > 0) AS vehicles_moving,
        COUNT(*) FILTER (WHERE speed_kmh = 0 AND ignition = TRUE) AS vehicles_idling
      FROM latest_telemetry
    `);

    // ── Recently Completed Trips ───────────────────────────────
    dashboardStep = 'recently completed trips';
    const recentlyCompleted = await pool.query(`
      SELECT
        g.id,
        g.trip_date,
        v.plate_number,
        d.full_name AS driver_name,
        g.origin_gps_start_point AS origin,
        g.destination_gps_end_point AS destination,
        g.arrival_time_gps,
        g.gps_distance_km,
        g.max_speed_kph
      FROM gps_trip_logs g
      LEFT JOIN vehicles v ON v.id = g.vehicle_id
      LEFT JOIN drivers d ON d.id = g.driver_id
      WHERE g.trip_status_gps = 'arrived'
        AND g.arrival_time_gps >= NOW() - INTERVAL '24 hours'
      ORDER BY g.arrival_time_gps DESC
      LIMIT 20
    `);

    // ── Active Trips (for real-time section) ───────────────────
    dashboardStep = 'active trips';
    const activeTrips = await pool.query(`
      SELECT
        to_.id,
        to_.to_number,
        v.plate_number,
        d.full_name AS driver_name,
        to_.origin_location,
        to_.destination_target,
        to_.scheduled_departure,
        to_.scheduled_arrival,
        to_.status
      FROM travel_orders to_
      LEFT JOIN vehicles v ON v.id = to_.vehicle_id
      LEFT JOIN drivers d ON d.id = to_.driver_id
      WHERE to_.status = 'ACTIVE'
      ORDER BY to_.scheduled_departure DESC
      LIMIT 20
    `);

    // ── Assemble response ──────────────────────────────────────
    res.json({
      success: true,
      data: {
        kpis: {
          fleet: fleetKpis.rows[0],
          travelOrders: travelOrderKpis.rows[0],
          gps: gpsKpis.rows[0],
          alerts: alertCounts.rows[0],
        },
        charts: {
          vehicleStatusDistribution: vehicleStatusDistribution.rows,
          travelOrdersByStatus: travelOrdersByStatus.rows,
          distanceLast30Days: distanceLast30Days.rows,
          tripsPerDay: tripsPerDay.rows,
        },
        tables: {
          liveMonitoring: liveMonitoring.rows,
          recentAlerts: recentAlerts.rows.map((r: any) => ({
            ...r,
            alertType: r.alert_type,
            alertMessage: r.alert_message,
            gpsRecordNo: r.gps_record_no,
          })),
          recentlyCompleted: recentlyCompleted.rows,
          activeTrips: activeTrips.rows,
        },
        leaderboard: {
          driverPerformance: driverLeaderboard.rows,
        },
        maintenance: {
          overview: maintenanceOverview.rows[0],
          trends: maintenanceTrends.rows,
        },
        admin: {
          matchingAccuracy: matchingAccuracy.rows[0],
          fleetUtilization: fleetUtilization.rows[0],
        },
        realTime: {
          vehiclesMoving: parseInt(realTimeStatus.rows[0]?.vehicles_moving || '0'),
          vehiclesIdling: parseInt(realTimeStatus.rows[0]?.vehicles_idling || '0'),
        },
      },
      message: 'Dashboard data retrieved successfully',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`GET /api/dashboard error at ${dashboardStep}:`, message);
    res.status(500).json({
      success: false,
      data: null,
      error: `Dashboard query failed at ${dashboardStep}`,
    });
  }
});

export default router;
