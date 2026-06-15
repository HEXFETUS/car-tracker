// ── Supabase Alert Persistence ─────────────────────────────────
//
// Safely inserts telemetry alert logs into our PostgreSQL database
// via the Supabase REST API or a direct pg connection.
//
// Fails gracefully if Supabase credentials are not set, allowing
// the tracker to continue running in dev/dry-run mode.

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || '';
const supabaseTable = process.env.SUPABASE_ALERTS_TABLE || 'telemetry_alerts';
const vehiclesTable = process.env.SUPABASE_VEHICLES_TABLE || 'vehicles';

/**
 * Check whether Supabase credentials are configured.
 * @returns {boolean}
 */
export function isSupabaseConfigured() {
  return Boolean(supabaseUrl && supabaseKey);
}

/**
 * Look up a vehicle's UUID by its plate number (case-insensitive).
 *
 * Performs: SELECT id FROM vehicles WHERE UPPER(plate_number) = UPPER($1)
 * via the Supabase REST API (rpc or direct query).
 *
 * @param {string} plateNumber - The raw plate number string to look up.
 * @returns {Promise<string|null>} The vehicle UUID if found, or null.
 */
export async function findVehicleIdByPlate(plateNumber) {
  if (!isSupabaseConfigured() || !plateNumber) return null;

  const trimmed = String(plateNumber).trim();
  if (!trimmed) return null;

  try {
    // Use Supabase RPC for case-insensitive plate lookup
    // Falls back to REST filter if the RPC function doesn't exist
    const rpcUrl = `${supabaseUrl}/rest/v1/rpc/find_vehicle_by_plate`;
    const rpcResponse = await fetch(rpcUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify({ p_plate_number: trimmed }),
    });

    if (rpcResponse.ok) {
      const data = await rpcResponse.json();
      if (Array.isArray(data) && data.length > 0 && data[0]?.id) {
        return data[0].id;
      }
      return null;
    }

    // Fallback: query using Supabase PostgREST filter
    const filterUrl = `${supabaseUrl}/rest/v1/${vehiclesTable}?plate_number=eq.${encodeURIComponent(trimmed)}&select=id&limit=1`;
    const filterResponse = await fetch(filterUrl, {
      method: 'GET',
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
    });

    if (!filterResponse.ok) return null;

    const rows = await filterResponse.json();
    if (Array.isArray(rows) && rows.length > 0 && rows[0]?.id) {
      return rows[0].id;
    }

    return null;
  } catch (error) {
    console.error('Vehicle plate lookup error:', error.message);
    return null;
  }
}

/**
 * Normalise a single alert record for database insertion.
 *
 * @param {{ type: string, message: string, vehicle_id?: string|null, location?: string|null, speed?: number|null, fuel?: number|null }} alert
 * @returns {object}
 */
function mapAlertToRow(alert) {
  return {
    alert_type: alert.type || 'message',
    message: alert.message,
    vehicle_id: alert.vehicle_id ?? null,
    location: alert.location ?? null,
    speed: alert.speed ?? null,
    fuel: alert.fuel ?? null,
    created_at: new Date().toISOString(),
  };
}

/**
 * Persist an array of alerts to Supabase.
 *
 * Each alert object should conform to:
 *   { type, message, vehicle_id, location, speed, fuel }
 *
 * @param {Array<{ type: string, message: string, vehicle_id?: string|null, location?: string|null, speed?: number|null, fuel?: number|null }>} alerts
 * @returns {Promise<{ ok: boolean, count: number, error?: string }>}
 */
export async function insertAlertsToSupabase(alerts) {
  if (!alerts || !alerts.length) {
    return { ok: true, count: 0 };
  }

  if (!isSupabaseConfigured()) {
    return { ok: false, count: 0, error: 'supabase_not_configured' };
  }

  try {
    const rows = alerts.map(mapAlertToRow);

    const response = await fetch(`${supabaseUrl}/rest/v1/${supabaseTable}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(rows),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'unknown error');
      console.error('Supabase insert error:', response.status, errorText);
      return { ok: false, count: 0, error: `http_${response.status}` };
    }

    return { ok: true, count: alerts.length };
  } catch (error) {
    console.error('Supabase insert exception:', error.message);
    return { ok: false, count: 0, error: error.message };
  }
}