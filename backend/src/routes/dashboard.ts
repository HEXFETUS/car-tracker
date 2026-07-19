import express, { type Request, type Response, type Router as ExpressRouter } from 'express';
import { getPool } from '../db/db.js';
import { syncFleetAndAlert, getVehicleDriver } from '@car-tracker/tracker';

const router: ExpressRouter = express.Router();

type QueryablePool = ReturnType<typeof getPool>;

async function timedQuery(pool: QueryablePool, label: string, sql: string, params?: unknown[]) {
  console.time(label);
  try {
    return await pool.query(sql, params);
  } finally {
    console.timeEnd(label);
  }
}

async function loadSummary(pool: QueryablePool) {
  const [fleetKpis, travelOrderKpis, gpsKpis, realTimeStatus] = await Promise.all([
    timedQuery(pool, 'dashboard fleetKpis', `
      SELECT
        (SELECT COUNT(*) FROM vehicles) AS total_vehicles,
        (SELECT COUNT(*) FROM vehicles WHERE under_repair = FALSE) AS available_vehicles,
        (SELECT COUNT(*) FROM travel_orders WHERE status = 'ACTIVE') AS active_trips,
        (SELECT COUNT(*) FROM vehicles WHERE under_repair = TRUE) AS vehicles_under_repair,
        (SELECT COUNT(*) FROM maintenance WHERE date >= CURRENT_DATE - INTERVAL '30 days') AS maintenance_due,
        (SELECT COUNT(*) FROM drivers) AS total_drivers
    `),
    timedQuery(pool, 'dashboard travelOrderKpis', `
      SELECT
        (SELECT COUNT(*) FROM travel_orders WHERE status = 'PENDING') AS pending_approval,
        (SELECT COUNT(*) FROM travel_orders WHERE status = 'APPROVED') AS approved,
        (SELECT COUNT(*) FROM travel_orders WHERE status = 'ACTIVE') AS active_travel_orders,
        (SELECT COUNT(*) FROM travel_orders WHERE status = 'COMPLETED' AND DATE(updated_at) = CURRENT_DATE) AS completed_today,
        (SELECT COUNT(*) FROM travel_orders WHERE status = 'CANCELLED') AS cancelled_orders
    `),
    timedQuery(pool, 'dashboard gpsKpis', `
      WITH date_context AS (
        SELECT (NOW() AT TIME ZONE 'Asia/Manila')::date AS today
      ),
      todays_trips AS (
        SELECT gps_distance_km AS distance_km, engine_hours, max_speed_kph, anomaly_flag
        FROM gps_trip_logs, date_context
        WHERE trip_date = today
        UNION ALL
        SELECT distance_km, engine_hours, max_speed_kph, anomaly_flag
        FROM gps_no_to_logs, date_context
        WHERE trip_date = today
          AND parent_trip_id IS NULL
          AND converted_gps_trip_log_id IS NULL
      ),
      telemetry_points AS (
        SELECT
          vehicle_id,
          recorded_at,
          speed_kmh,
          LAG(recorded_at) OVER (PARTITION BY vehicle_id ORDER BY recorded_at) AS previous_at,
          LAG(speed_kmh) OVER (PARTITION BY vehicle_id ORDER BY recorded_at) AS previous_speed
        FROM gps_telemetry, date_context
        WHERE recorded_at >= today::timestamp AT TIME ZONE 'Asia/Manila'
          AND recorded_at < (today + 1)::timestamp AT TIME ZONE 'Asia/Manila'
      )
      SELECT
        (SELECT COUNT(*) FROM todays_trips) AS trips_recorded_today,
        (SELECT COALESCE(SUM(distance_km), 0) FROM todays_trips) AS total_distance_today,
        (SELECT COALESCE(AVG(distance_km), 0) FROM todays_trips) AS avg_distance_per_trip,
        (SELECT COALESCE(MAX(max_speed_kph), 0) FROM todays_trips) AS max_speed_today,
        (SELECT COALESCE(SUM(engine_hours), 0) FROM todays_trips) AS engine_hours_today,
        (SELECT COALESCE(AVG(speed_kmh) FILTER (WHERE speed_kmh > 0), 0) FROM telemetry_points) AS average_speed_today,
        (SELECT COALESCE(SUM(
          CASE
            WHEN previous_at IS NOT NULL
              AND recorded_at - previous_at <= INTERVAL '10 minutes'
              AND (speed_kmh > 0 OR previous_speed > 0)
            THEN EXTRACT(EPOCH FROM (recorded_at - previous_at)) / 3600.0
            ELSE 0
          END
        ), 0) FROM telemetry_points) AS moving_hours_today,
        (SELECT COUNT(*) FROM gps_telemetry, date_context
          WHERE recorded_at >= today::timestamp AT TIME ZONE 'Asia/Manila'
            AND recorded_at < (today + 1)::timestamp AT TIME ZONE 'Asia/Manila'
            AND UPPER(event_type) = 'LOW_FUEL') AS fuel_alerts_today,
        (
          (SELECT COUNT(*) FROM gps_trip_logs, date_context WHERE anomaly_flag = TRUE AND trip_date >= today - 7)
          +
          (SELECT COUNT(*) FROM gps_no_to_logs, date_context
            WHERE anomaly_flag = TRUE AND trip_date >= today - 7
              AND parent_trip_id IS NULL AND converted_gps_trip_log_id IS NULL)
        ) AS gps_anomalies_detected
    `),
    timedQuery(pool, 'dashboard realTimeStatus', `
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
    `),
  ]);

  return {
    kpis: {
      fleet: fleetKpis.rows[0],
      travelOrders: travelOrderKpis.rows[0],
      gps: gpsKpis.rows[0],
      alerts: {
        ignition_on_alerts: 0,
        ignition_off_alerts: 0,
        idling_alerts: 0,
        active_gps_alerts: 0,
      },
    },
    realTime: {
      vehiclesMoving: parseInt(realTimeStatus.rows[0]?.vehicles_moving || '0', 10),
      vehiclesIdling: parseInt(realTimeStatus.rows[0]?.vehicles_idling || '0', 10),
    },
  };
}

async function loadCharts(pool: QueryablePool) {
  const [vehicleStatusDistribution, travelOrdersByStatus, distanceLast30Days, tripsPerDay] = await Promise.all([
    timedQuery(pool, 'dashboard vehicleStatusDistribution', `
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
    `),
    timedQuery(pool, 'dashboard travelOrdersByStatus', `
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
    `),
    timedQuery(pool, 'dashboard distanceLast30Days', `
      SELECT
        trip_date AS date,
        COALESCE(SUM(gps_distance_km), 0) AS total_distance
      FROM gps_trip_logs
      WHERE trip_date >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY trip_date
      ORDER BY trip_date ASC
    `),
    timedQuery(pool, 'dashboard tripsPerDay', `
      SELECT
        trip_date AS date,
        COUNT(*) AS trips
      FROM gps_trip_logs
      WHERE trip_date >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY trip_date
      ORDER BY trip_date ASC
    `),
  ]);

  return {
    charts: {
      vehicleStatusDistribution: vehicleStatusDistribution.rows,
      travelOrdersByStatus: travelOrdersByStatus.rows,
      distanceLast30Days: distanceLast30Days.rows,
      tripsPerDay: tripsPerDay.rows,
    },
  };
}

async function loadLive(pool: QueryablePool) {
  let liveMonitoringRows: any[] = [];
  let liveSource = 'db';
  let activeTripsRows: any[] = [];

  // Travel-order state is stored locally, while current position comes from
  // Cartrack. Load both and merge them by the canonical plate number.
  const vehicleContextResult = await timedQuery(pool, 'dashboard liveVehicleContext', `
    SELECT
      v.id AS vehicle_id,
      v.plate_number,
      v.under_repair,
      COALESCE(d.full_name, 'Unassigned') AS driver_name,
      current_order.id AS current_travel_order_id,
      current_order.to_number AS current_travel_order,
      current_order.origin_location AS origin,
      current_order.destination_target AS destination,
      current_order.scheduled_departure AS departure_time,
      current_order.scheduled_arrival AS arrival_time,
      current_order.status AS trip_status,
      COALESCE(current_log.gps_distance_km, 0) AS distance_traveled
    FROM vehicles v
    LEFT JOIN LATERAL (
      SELECT t.*
      FROM travel_orders t
      WHERE t.vehicle_id = v.id
        AND t.status IN ('ACTIVE', 'APPROVED')
      ORDER BY CASE WHEN t.status = 'ACTIVE' THEN 0 ELSE 1 END, t.updated_at DESC
      LIMIT 1
    ) current_order ON TRUE
    LEFT JOIN drivers d ON d.id = current_order.driver_id
    LEFT JOIN LATERAL (
      SELECT g.gps_distance_km
      FROM gps_trip_logs g
      WHERE g.travel_order_id = current_order.id
      ORDER BY g.created_at DESC
      LIMIT 1
    ) current_log ON TRUE
  `);
  const contextByPlate = new Map(
    vehicleContextResult.rows.map((row: any) => [String(row.plate_number).replace(/\s+/g, '').toUpperCase(), row]),
  );

  const enrichLiveRow = (row: any) => {
    const plateKey = String(row.plate_number ?? '').replace(/\s+/g, '').toUpperCase();
    const context = contextByPlate.get(plateKey) as any;
    if (!context) return row;
    return {
      ...row,
      ...context,
      // Keep the fresh tracker location fields after applying DB context.
      latitude: row.latitude,
      longitude: row.longitude,
      last_seen: row.last_seen,
      speed_kmh: row.speed_kmh,
      ignition: row.ignition,
      location_name: row.location_name,
      driver_name: context.current_travel_order ? context.driver_name : row.driver_name,
    };
  };

  // Try current fleet snapshot from Cartrack first
  try {
    const fleetResult = await syncFleetAndAlert({ dispatchAlerts: false });
    const mapped = (fleetResult.data || [])
      .map((v: any) => {
        const coordinates = v.coordinates || {};
        const latitude = Number.isFinite(coordinates.latitude) ? coordinates.latitude : null;
        const longitude = Number.isFinite(coordinates.longitude) ? coordinates.longitude : null;
        return {
          vehicle_id: String(v.id ?? ''),
          plate_number: String(v.name ?? '').split(' ')[0] || String(v.id ?? ''),
          driver_name: getVehicleDriver(v) || 'Unassigned',
          latitude,
          longitude,
          last_seen: v.time || new Date().toISOString(),
          speed_kmh: Number(v.speed ?? 0),
          ignition: v.ignition === true,
          location_name: v.location || null,
        };
      })
      .filter((row: any) => row.latitude != null && row.longitude != null);

    if (mapped.length > 0) {
      liveSource = 'cartrack';
      liveMonitoringRows = mapped.map(enrichLiveRow);
    }
  } catch (error) {
    console.error('[dashboard] syncFleetAndAlert failed:', error instanceof Error ? error.message : String(error));
  }

  // Fallback to latest telemetry if Cartrack returned nothing
  if (liveMonitoringRows.length === 0) {
    const fallbackResult = await timedQuery(pool, 'dashboard liveMonitoring', `
      SELECT
        v.id AS vehicle_id,
        v.plate_number,
        COALESCE(d.full_name, 'Unassigned') AS driver_name,
        latest.latitude,
        latest.longitude,
        latest.recorded_at AS last_seen,
        latest.speed_kmh,
        latest.ignition,
        latest.location_name
      FROM vehicles v
      LEFT JOIN drivers d ON d.id = (
        SELECT driver_id
        FROM travel_orders
        WHERE vehicle_id = v.id
          AND status IN ('ACTIVE', 'APPROVED')
        ORDER BY created_at DESC
        LIMIT 1
      )
      LEFT JOIN LATERAL (
        SELECT latitude, longitude, recorded_at, speed_kmh, ignition, location_name
        FROM gps_telemetry
        WHERE vehicle_id = v.id
        ORDER BY COALESCE(recorded_at, created_at) DESC
        LIMIT 1
      ) latest ON TRUE
      WHERE latest.latitude IS NOT NULL
        AND latest.longitude IS NOT NULL
      ORDER BY v.plate_number ASC
      LIMIT 50
    `);
    liveMonitoringRows = fallbackResult.rows.map(enrichLiveRow);
  }

  // Always fetch active trips from DB (travel order state lives in DB)
  const activeTripsResult = await timedQuery(pool, 'dashboard activeTrips', `
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
    LIMIT 10
  `);
  activeTripsRows = activeTripsResult.rows;

  console.log('dashboard live source', {
    source: liveSource,
    vehicles: liveMonitoringRows.length,
    moving: liveMonitoringRows.filter((v) => Number(v.speed_kmh ?? 0) > 0).length,
  });

  return {
    tables: {
      liveMonitoring: liveMonitoringRows,
      activeTrips: activeTripsRows,
    },
  };
}

async function loadTables(pool: QueryablePool) {
  const [driverLeaderboard, maintenanceOverview, maintenanceTrends, matchingAccuracy, totalVehiclesResult, recentlyCompleted] = await Promise.all([
    timedQuery(pool, 'dashboard driverLeaderboard', `
      SELECT
        d.id AS driver_id,
        d.full_name AS driver_name,
        COUNT(DISTINCT g.id) AS total_trips,
        COALESCE(SUM(g.gps_distance_km), 0) AS total_distance,
        COALESCE(AVG(g.max_speed_kph), 0) AS avg_speed,
        COUNT(DISTINCT CASE WHEN to_.status = 'COMPLETED' THEN to_.id END) AS on_time_arrivals,
        COUNT(DISTINCT CASE WHEN g.anomaly_flag = TRUE THEN g.id END) AS gps_violations
      FROM drivers d
      LEFT JOIN gps_trip_logs g
        ON g.driver_id = d.id
       AND g.trip_date >= CURRENT_DATE - INTERVAL '90 days'
      LEFT JOIN travel_orders to_
        ON to_.driver_id = d.id
       AND to_.scheduled_departure >= CURRENT_DATE - INTERVAL '90 days'
      WHERE d.status = 'active'
      GROUP BY d.id, d.full_name
      ORDER BY total_trips DESC, d.full_name ASC
    `),
    timedQuery(pool, 'dashboard maintenanceOverview', `
      SELECT
        (SELECT COUNT(*) FROM maintenance WHERE date >= CURRENT_DATE) AS scheduled_maintenance,
        (SELECT COUNT(*) FROM maintenance WHERE date < CURRENT_DATE AND date >= CURRENT_DATE - INTERVAL '90 days') AS overdue_maintenance,
        (SELECT COUNT(*) FROM maintenance WHERE date >= DATE_TRUNC('month', CURRENT_DATE)) AS maintenance_this_month,
        (SELECT COALESCE(SUM(cost), 0) FROM maintenance WHERE date >= DATE_TRUNC('month', CURRENT_DATE)) AS maintenance_cost
    `),
    timedQuery(pool, 'dashboard maintenanceTrends', `
      SELECT
        TO_CHAR(DATE_TRUNC('month', date), 'YYYY-MM') AS month,
        COUNT(*) AS count,
        COALESCE(SUM(cost), 0) AS total_cost
      FROM maintenance
      WHERE date >= CURRENT_DATE - INTERVAL '12 months'
      GROUP BY DATE_TRUNC('month', date)
      ORDER BY month ASC
    `),
    timedQuery(pool, 'dashboard matchingAccuracy', `
      SELECT
        (SELECT COUNT(*) FROM gps_trip_logs WHERE travel_order_id IS NOT NULL) AS gps_logs_linked_to_to,
        (
          (SELECT COUNT(*) FROM gps_trip_logs WHERE travel_order_id IS NULL)
          +
          (SELECT COUNT(*) FROM gps_no_to_logs
            WHERE status = 'unmatched' AND parent_trip_id IS NULL
              AND converted_gps_trip_log_id IS NULL)
        ) AS gps_logs_without_to,
        (SELECT COUNT(*) FROM gps_trip_logs WHERE LOWER(to_status_auto) = 'matched') AS auto_matched_trips,
        (SELECT COUNT(*) FROM gps_trip_logs WHERE LOWER(to_status_auto) = 'manual') AS manual_corrections
    `),
    timedQuery(pool, 'dashboard totalVehicles', `SELECT COUNT(*) AS cnt FROM vehicles`),
    timedQuery(pool, 'dashboard recentlyCompleted', `
      WITH eligible_trips AS (
        SELECT
          g.id,
          'gps_trip_log'::text AS log_source,
          g.vehicle_id,
          g.gps_record_no AS record_no,
          CASE
            WHEN g.travel_order_id IS NULL THEN 'no_travel_order'::text
            ELSE 'travel_order'::text
          END AS trip_type,
          g.trip_date,
          v.plate_number,
          d.full_name AS driver_name,
          g.origin_gps_start_point AS origin,
          g.destination_gps_end_point AS destination,
          g.departure_time_gps AS departure_time,
          g.arrival_time_gps,
          g.gps_distance_km,
          g.engine_hours AS stored_engine_hours,
          NULL::numeric AS stored_moving_hours,
          g.max_speed_kph
        FROM gps_trip_logs g
        LEFT JOIN vehicles v ON v.id = g.vehicle_id
        LEFT JOIN drivers d ON d.id = g.driver_id
        WHERE g.trip_status_gps IN ('arrived', 'completed')
          AND g.arrival_time_gps IS NOT NULL

        UNION ALL

        SELECT
          n.id,
          'gps_no_to_log'::text AS log_source,
          n.vehicle_id,
          n.no_to_record_no AS record_no,
          'no_travel_order'::text AS trip_type,
          n.trip_date,
          v.plate_number,
          d.full_name AS driver_name,
          n.origin_address AS origin,
          COALESCE(n.end_address, n.destination_address) AS destination,
          n.departure_time AT TIME ZONE 'UTC' AS departure_time,
          COALESCE(
            n.end_time,
            n.returned_to_base_at,
            n.arrival_time AT TIME ZONE 'UTC'
          ) AS arrival_time_gps,
          n.distance_km AS gps_distance_km,
          n.engine_hours AS stored_engine_hours,
          n.moving_hours AS stored_moving_hours,
          n.max_speed_kph
        FROM gps_no_to_logs n
        LEFT JOIN vehicles v ON v.id = n.vehicle_id
        LEFT JOIN drivers d ON d.id = n.driver_id
        WHERE n.business_trip_status = 'COMPLETED'
          AND n.parent_trip_id IS NULL
          AND n.converted_gps_trip_log_id IS NULL
          AND COALESCE(
            n.end_time,
            n.returned_to_base_at,
            n.arrival_time AT TIME ZONE 'UTC'
          ) IS NOT NULL
      ),
      latest_day AS (
        SELECT MAX(trip_date) AS trip_date
        FROM eligible_trips
      ),
      recent_trips AS (
        SELECT trip.*
        FROM eligible_trips trip
        JOIN latest_day latest ON latest.trip_date = trip.trip_date
      ),
      trip_sessions AS (
        SELECT
          trip.log_source,
          trip.id AS trip_id,
          session.active_trip_id,
          session.start_time,
          session.end_time
        FROM recent_trips trip
        JOIN gps_trip_log_active_trips session
          ON trip.log_source = 'gps_trip_log'
         AND session.gps_trip_log_id = trip.id

        UNION ALL

        SELECT
          trip.log_source,
          trip.id AS trip_id,
          session.active_trip_id,
          session.start_time,
          session.end_time
        FROM recent_trips trip
        JOIN gps_no_to_log_active_trips session
          ON trip.log_source = 'gps_no_to_log'
         AND session.gps_no_to_log_id = trip.id
      ),
      session_points AS (
        SELECT
          session.log_source,
          session.trip_id,
          session.active_trip_id,
          telemetry.recorded_at,
          telemetry.speed_kmh,
          LAG(telemetry.recorded_at) OVER (
            PARTITION BY session.log_source, session.trip_id, session.active_trip_id
            ORDER BY telemetry.recorded_at
          ) AS previous_at,
          LAG(telemetry.speed_kmh) OVER (
            PARTITION BY session.log_source, session.trip_id, session.active_trip_id
            ORDER BY telemetry.recorded_at
          ) AS previous_speed
        FROM trip_sessions session
        JOIN recent_trips trip
          ON trip.log_source = session.log_source
         AND trip.id = session.trip_id
        JOIN gps_telemetry telemetry
          ON telemetry.vehicle_id = trip.vehicle_id
         AND telemetry.active_trip_id = session.active_trip_id
         AND (session.start_time IS NULL OR telemetry.recorded_at >= session.start_time)
         AND (session.end_time IS NULL OR telemetry.recorded_at <= session.end_time)
      ),
      session_metrics AS (
        SELECT
          log_source,
          trip_id,
          active_trip_id,
          COUNT(*) AS telemetry_point_count,
          EXTRACT(EPOCH FROM (MAX(recorded_at) - MIN(recorded_at))) / 3600.0 AS engine_hours,
          COALESCE(SUM(
            CASE
              WHEN previous_at IS NOT NULL
                AND recorded_at > previous_at
                AND recorded_at - previous_at <= INTERVAL '10 minutes'
                AND (COALESCE(speed_kmh, 0) > 0 OR COALESCE(previous_speed, 0) > 0)
              THEN EXTRACT(EPOCH FROM (recorded_at - previous_at)) / 3600.0
              ELSE 0
            END
          ), 0) AS moving_hours
        FROM session_points
        GROUP BY log_source, trip_id, active_trip_id
      ),
      trip_metrics AS (
        SELECT
          log_source,
          trip_id,
          SUM(telemetry_point_count) AS telemetry_point_count,
          SUM(engine_hours) AS engine_hours,
          SUM(moving_hours) AS moving_hours
        FROM session_metrics
        GROUP BY log_source, trip_id
      ),
      resolved_metrics AS (
        SELECT
          trip.*,
          CASE
            WHEN metrics.telemetry_point_count > 0
              THEN GREATEST(metrics.engine_hours, metrics.moving_hours, 0)
            ELSE COALESCE(
              trip.stored_engine_hours,
              CASE
                WHEN trip.departure_time IS NOT NULL
                  AND trip.arrival_time_gps > trip.departure_time
                THEN EXTRACT(EPOCH FROM (trip.arrival_time_gps - trip.departure_time)) / 3600.0
                ELSE NULL
              END,
              trip.stored_moving_hours
            )
          END AS resolved_engine_hours,
          CASE
            WHEN metrics.telemetry_point_count > 0 THEN GREATEST(metrics.moving_hours, 0)
            ELSE trip.stored_moving_hours
          END AS candidate_moving_hours
        FROM recent_trips trip
        LEFT JOIN trip_metrics metrics
          ON metrics.log_source = trip.log_source
         AND metrics.trip_id = trip.id
      )
      SELECT
        trip.id,
        trip.record_no,
        trip.trip_type,
        trip.trip_date,
        trip.plate_number,
        trip.driver_name,
        trip.origin,
        trip.destination,
        trip.arrival_time_gps,
        trip.gps_distance_km,
        trip.resolved_engine_hours AS engine_hours,
        CASE
          WHEN trip.candidate_moving_hours IS NULL THEN NULL
          WHEN trip.resolved_engine_hours IS NULL THEN GREATEST(trip.candidate_moving_hours, 0)
          ELSE LEAST(
            GREATEST(trip.candidate_moving_hours, 0),
            GREATEST(trip.resolved_engine_hours, 0)
          )
        END AS moving_hours,
        trip.max_speed_kph
      FROM resolved_metrics trip
      ORDER BY
        COALESCE((substring(trip.record_no FROM '([0-9]+)$'))::bigint, 9223372036854775807),
        trip.record_no ASC
    `),
  ]);

  const totalVehicles = Number(totalVehiclesResult.rows[0]?.cnt || 0);
  const fleetUtilization = totalVehicles > 0
    ? await timedQuery(pool, 'dashboard fleetUtilization', `
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
    `, [totalVehicles])
    : { rows: [{ daily_utilization: 0, weekly_utilization: 0, monthly_utilization: 0 }] };

  return {
    tables: {
      recentlyCompleted: recentlyCompleted.rows,
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
  };
}

async function sendDashboardSection(res: Response, sectionName: string, loader: (pool: QueryablePool) => Promise<unknown>) {
  console.time(`dashboard ${sectionName} total`);
  try {
    const data = await loader(getPool());
    res.json({
      success: true,
      data,
      message: `Dashboard ${sectionName} data retrieved successfully`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`GET /api/dashboard/${sectionName} error:`, message);
    res.status(500).json({
      success: false,
      data: null,
      error: `Dashboard ${sectionName} query failed`,
    });
  } finally {
    console.timeEnd(`dashboard ${sectionName} total`);
  }
}

router.get('/summary', async (_req: Request, res: Response) => {
  await sendDashboardSection(res, 'summary', loadSummary);
});

router.get('/charts', async (_req: Request, res: Response) => {
  await sendDashboardSection(res, 'charts', loadCharts);
});

router.get('/live', async (_req: Request, res: Response) => {
  await sendDashboardSection(res, 'live', loadLive);
});

router.get('/tables', async (_req: Request, res: Response) => {
  await sendDashboardSection(res, 'tables', loadTables);
});

// GET /api/dashboard — Aggregated dashboard data kept for compatibility.
router.get('/', async (_req: Request, res: Response) => {
  console.time('dashboard total');
  try {
    const pool = getPool();
    const [summary, charts, live, tables] = await Promise.all([
      loadSummary(pool),
      loadCharts(pool),
      loadLive(pool),
      loadTables(pool),
    ]);

    res.json({
      success: true,
      data: {
        ...summary,
        ...charts,
        tables: {
          ...live.tables,
          ...tables.tables,
        },
        leaderboard: tables.leaderboard,
        maintenance: tables.maintenance,
        admin: tables.admin,
      },
      message: 'Dashboard data retrieved successfully',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('GET /api/dashboard error:', message);
    res.status(500).json({
      success: false,
      data: null,
      error: 'Dashboard query failed',
    });
  } finally {
    console.timeEnd('dashboard total');
  }
});

export default router;
