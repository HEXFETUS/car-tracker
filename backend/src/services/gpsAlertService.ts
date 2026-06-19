// ── GPS Alert Service ──────────────────────────────────────────
//
// Database operations for the gps_alerts table.

import { getPool } from '../db/db.js';

export interface GpsAlertRow {
  id: string;
  vehicle_id: string;
  gps_log_id: string | null;
  alert_type: string;
  alert_message: string;
  latitude: number | null;
  longitude: number | null;
  created_at: string;
}

export interface CreateGpsAlertInput {
  vehicleId: string;
  gpsLogId?: string | null;
  alertType: 'IGNITION_ON' | 'IGNITION_OFF' | 'IDLING';
  alertMessage: string;
  latitude?: number | null;
  longitude?: number | null;
}

/**
 * Insert a new GPS alert record.
 */
export async function createGpsAlert(input: CreateGpsAlertInput): Promise<{ id: string }> {
  const pool = getPool();
  const result = await pool.query<{ id: string }>(
    `INSERT INTO gps_alerts
       (vehicle_id, gps_log_id, alert_type, alert_message, latitude, longitude)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      input.vehicleId,
      input.gpsLogId ?? null,
      input.alertType,
      input.alertMessage,
      input.latitude ?? null,
      input.longitude ?? null,
    ],
  );
  return result.rows[0];
}

export interface FetchAlertsParams {
  page?: number;
  pageSize?: number;
  vehicleId?: string;
  alertType?: string;
}

export interface GpsAlertsResult {
  success: boolean;
  data: GpsAlertRow[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Fetch GPS alerts with pagination and optional filters.
 */
export async function fetchGpsAlerts(params: FetchAlertsParams = {}): Promise<GpsAlertsResult> {
  const pool = getPool();
  const page = Math.max(1, params.page || 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize || 20));
  const offset = (page - 1) * pageSize;

  const conditions: string[] = [];
  const values: unknown[] = [];

  if (params.vehicleId) {
    conditions.push(`vehicle_id = $${values.length + 1}`);
    values.push(params.vehicleId);
  }
  if (params.alertType) {
    conditions.push(`alert_type = $${values.length + 1}`);
    values.push(params.alertType);
  }

  const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  const countResult = await pool.query<{ total: string }>(
    `SELECT COUNT(*) AS total FROM gps_alerts ${whereClause}`,
    values,
  );
  const total = parseInt(countResult.rows[0]?.total || '0', 10);

  const dataResult = await pool.query<GpsAlertRow>(
    `SELECT id, vehicle_id, gps_log_id, alert_type, alert_message,
            latitude, longitude, created_at
     FROM gps_alerts
     ${whereClause}
     ORDER BY created_at DESC
     LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, pageSize, offset],
  );

  return {
    success: true,
    data: dataResult.rows,
    total,
    page,
    pageSize,
  };
}

/**
 * Get the plate number for a vehicle.
 */
export async function getVehiclePlate(vehicleId: string): Promise<string | null> {
  const pool = getPool();
  const result = await pool.query<{ plate_number: string }>(
    `SELECT plate_number FROM vehicles WHERE id = $1 LIMIT 1`,
    [vehicleId],
  );
  return result.rows[0]?.plate_number ?? null;
}