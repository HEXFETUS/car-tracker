// ── Dashboard API ─────────────────────────────────────────────
//
// Frontend API client for the aggregated dashboard endpoint.

const API_BASE = '/api/dashboard';

export interface DashboardKpis {
  fleet: {
    total_vehicles: number;
    available_vehicles: number;
    active_trips: number;
    vehicles_under_repair: number;
    maintenance_due: number;
    total_drivers: number;
  };
  travelOrders: {
    pending_approval: number;
    approved: number;
    active_travel_orders: number;
    completed_today: number;
    cancelled_orders: number;
  };
  gps: {
    trips_recorded_today: number;
    total_distance_today: number;
    avg_distance_per_trip: number;
    max_speed_today: number;
    gps_anomalies_detected: number;
  };
  alerts: {
    ignition_on_alerts: number;
    ignition_off_alerts: number;
    idling_alerts: number;
    active_gps_alerts: number;
  };
}

export interface ChartDataPoint {
  name: string;
  value: number;
}

export interface TimeSeriesPoint {
  date: string;
  total_distance?: number;
  trips?: number;
}

export interface LiveMonitoringRow {
  vehicle_id: string;
  plate_number: string;
  driver_name: string;
  current_travel_order: string | null;
  current_travel_order_id: string | null;
  origin: string | null;
  destination: string | null;
  departure_time: string | null;
  arrival_time: string | null;
  trip_status: string | null;
  distance_traveled: number;
  latitude: number | null;
  longitude: number | null;
  last_seen: string | null;
}

export interface AlertRow {
  id: string;
  time: string;
  vehicle: string;
  alert_type: string;
  alert_message: string;
  location: string;
  gps_record_no: string | null;
}

export interface DriverPerformanceRow {
  driver_id: string;
  driver_name: string;
  total_trips: number;
  total_distance: number;
  avg_speed: number;
  on_time_arrivals: number;
  gps_violations: number;
}

export interface MaintenanceOverview {
  scheduled_maintenance: number;
  overdue_maintenance: number;
  maintenance_this_month: number;
  maintenance_cost: number;
}

export interface MaintenanceTrendRow {
  month: string;
  count: number;
  total_cost: number;
}

export interface MatchingAccuracy {
  gps_logs_linked_to_to: number;
  gps_logs_without_to: number;
  auto_matched_trips: number;
  manual_corrections: number;
}

export interface FleetUtilization {
  daily_utilization: number;
  weekly_utilization: number;
  monthly_utilization: number;
}

export interface RecentlyCompletedRow {
  id: string;
  trip_date: string;
  plate_number: string;
  driver_name: string;
  origin: string;
  destination: string;
  arrival_time_gps: string | null;
  gps_distance_km: number | null;
  max_speed_kph: number | null;
}

export interface ActiveTripRow {
  id: string;
  to_number: string;
  plate_number: string;
  driver_name: string;
  origin_location: string;
  destination_target: string;
  scheduled_departure: string | null;
  scheduled_arrival: string | null;
  status: string;
}

export interface DashboardData {
  kpis: DashboardKpis;
  charts: {
    vehicleStatusDistribution: ChartDataPoint[];
    travelOrdersByStatus: ChartDataPoint[];
    distanceLast30Days: TimeSeriesPoint[];
    tripsPerDay: TimeSeriesPoint[];
  };
  tables: {
    liveMonitoring: LiveMonitoringRow[];
    recentAlerts: AlertRow[];
    recentlyCompleted: RecentlyCompletedRow[];
    activeTrips: ActiveTripRow[];
  };
  leaderboard: {
    driverPerformance: DriverPerformanceRow[];
  };
  maintenance: {
    overview: MaintenanceOverview;
    trends: MaintenanceTrendRow[];
  };
  admin: {
    matchingAccuracy: MatchingAccuracy;
    fleetUtilization: FleetUtilization;
  };
  realTime: {
    vehiclesMoving: number;
    vehiclesIdling: number;
  };
}

export interface DashboardResponse {
  success: boolean;
  data: DashboardData;
  message?: string;
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function normalizeChartPoint(point: ChartDataPoint): ChartDataPoint {
  return {
    ...point,
    value: toNumber(point.value),
  };
}

function normalizeTimeSeriesPoint(point: TimeSeriesPoint): TimeSeriesPoint {
  return {
    ...point,
    total_distance: point.total_distance === undefined ? undefined : toNumber(point.total_distance),
    trips: point.trips === undefined ? undefined : toNumber(point.trips),
  };
}

function normalizeDashboardData(data: DashboardData): DashboardData {
  return {
    ...data,
    kpis: {
      fleet: {
        total_vehicles: toNumber(data.kpis.fleet.total_vehicles),
        available_vehicles: toNumber(data.kpis.fleet.available_vehicles),
        active_trips: toNumber(data.kpis.fleet.active_trips),
        vehicles_under_repair: toNumber(data.kpis.fleet.vehicles_under_repair),
        maintenance_due: toNumber(data.kpis.fleet.maintenance_due),
        total_drivers: toNumber(data.kpis.fleet.total_drivers),
      },
      travelOrders: {
        pending_approval: toNumber(data.kpis.travelOrders.pending_approval),
        approved: toNumber(data.kpis.travelOrders.approved),
        active_travel_orders: toNumber(data.kpis.travelOrders.active_travel_orders),
        completed_today: toNumber(data.kpis.travelOrders.completed_today),
        cancelled_orders: toNumber(data.kpis.travelOrders.cancelled_orders),
      },
      gps: {
        trips_recorded_today: toNumber(data.kpis.gps.trips_recorded_today),
        total_distance_today: toNumber(data.kpis.gps.total_distance_today),
        avg_distance_per_trip: toNumber(data.kpis.gps.avg_distance_per_trip),
        max_speed_today: toNumber(data.kpis.gps.max_speed_today),
        gps_anomalies_detected: toNumber(data.kpis.gps.gps_anomalies_detected),
      },
      alerts: {
        ignition_on_alerts: toNumber(data.kpis.alerts.ignition_on_alerts),
        ignition_off_alerts: toNumber(data.kpis.alerts.ignition_off_alerts),
        idling_alerts: toNumber(data.kpis.alerts.idling_alerts),
        active_gps_alerts: toNumber(data.kpis.alerts.active_gps_alerts),
      },
    },
    charts: {
      vehicleStatusDistribution: data.charts.vehicleStatusDistribution.map(normalizeChartPoint),
      travelOrdersByStatus: data.charts.travelOrdersByStatus.map(normalizeChartPoint),
      distanceLast30Days: data.charts.distanceLast30Days.map(normalizeTimeSeriesPoint),
      tripsPerDay: data.charts.tripsPerDay.map(normalizeTimeSeriesPoint),
    },
    tables: {
      liveMonitoring: data.tables.liveMonitoring.map((row) => ({
        ...row,
        distance_traveled: toNumber(row.distance_traveled),
        latitude: row.latitude === null ? null : toNumber(row.latitude),
        longitude: row.longitude === null ? null : toNumber(row.longitude),
      })),
      recentAlerts: data.tables.recentAlerts,
      recentlyCompleted: data.tables.recentlyCompleted.map((row) => ({
        ...row,
        gps_distance_km: row.gps_distance_km === null ? null : toNumber(row.gps_distance_km),
        max_speed_kph: row.max_speed_kph === null ? null : toNumber(row.max_speed_kph),
      })),
      activeTrips: data.tables.activeTrips,
    },
    leaderboard: {
      driverPerformance: data.leaderboard.driverPerformance.map((row) => ({
        ...row,
        total_trips: toNumber(row.total_trips),
        total_distance: toNumber(row.total_distance),
        avg_speed: toNumber(row.avg_speed),
        on_time_arrivals: toNumber(row.on_time_arrivals),
        gps_violations: toNumber(row.gps_violations),
      })),
    },
    maintenance: {
      overview: {
        scheduled_maintenance: toNumber(data.maintenance.overview.scheduled_maintenance),
        overdue_maintenance: toNumber(data.maintenance.overview.overdue_maintenance),
        maintenance_this_month: toNumber(data.maintenance.overview.maintenance_this_month),
        maintenance_cost: toNumber(data.maintenance.overview.maintenance_cost),
      },
      trends: data.maintenance.trends.map((row) => ({
        ...row,
        count: toNumber(row.count),
        total_cost: toNumber(row.total_cost),
      })),
    },
    admin: {
      matchingAccuracy: {
        gps_logs_linked_to_to: toNumber(data.admin.matchingAccuracy.gps_logs_linked_to_to),
        gps_logs_without_to: toNumber(data.admin.matchingAccuracy.gps_logs_without_to),
        auto_matched_trips: toNumber(data.admin.matchingAccuracy.auto_matched_trips),
        manual_corrections: toNumber(data.admin.matchingAccuracy.manual_corrections),
      },
      fleetUtilization: {
        daily_utilization: toNumber(data.admin.fleetUtilization.daily_utilization),
        weekly_utilization: toNumber(data.admin.fleetUtilization.weekly_utilization),
        monthly_utilization: toNumber(data.admin.fleetUtilization.monthly_utilization),
      },
    },
    realTime: {
      vehiclesMoving: toNumber(data.realTime.vehiclesMoving),
      vehiclesIdling: toNumber(data.realTime.vehiclesIdling),
    },
  };
}

/**
 * Fetch all dashboard data in a single aggregated call.
 */
export async function fetchDashboardData(): Promise<DashboardData> {
  const res = await fetch(API_BASE);
  if (!res.ok) {
    let message = `Failed to fetch dashboard data (HTTP ${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = String(body.error);
    } catch {
      // Keep the status-based message if the response is not JSON.
    }
    throw new Error(message);
  }
  const json: DashboardResponse = await res.json();
  if (!json.success || !json.data) {
    throw new Error(json.message || 'Dashboard response did not include data');
  }
  return normalizeDashboardData(json.data);
}
