import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import express from 'express';
import { setPoolForTest } from '../db/db.js';
import gpsLogsRouter from './gps-logs.js';

afterEach(() => setPoolForTest(null));

describe('GET /gps-logs/no-to', () => {
  it('returns root No-TO records with pagination and filters', async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const row = {
      id: '10000000-0000-4000-8000-000000000001',
      no_to_record_no: 'NO-TO-2026-0016',
      trip_date: '2026-07-29',
      vehicle_id: '20000000-0000-4000-8000-000000000001',
      driver_id: null,
      travel_order_id: null,
      linked_to_number: null,
      plate_number: 'TEST-001',
      driver_full_name: null,
      origin_address: 'Actual origin',
      origin_coordinates: '8.45,124.62',
      destination_address: 'Destination',
      destination_coordinates: '8.46,124.63',
      departure_time: '2026-07-29T01:00:00+08:00',
      arrival_time: null,
      distance_km: '5.25',
      engine_hours: '1.5',
      moving_hours: '1.0',
      max_speed_kph: '42',
      status: 'unmatched',
      business_trip_status: 'OUTBOUND',
      end_time: null,
      anomaly_flag: true,
      anomaly_reason: 'No matching TO',
      notes: null,
      linked_at: null,
      converted_gps_trip_log_id: null,
      created_at: '2026-07-29T01:00:00Z',
    };
    const pool = {
      async query(sql: string, params: unknown[] = []) {
        queries.push({ sql, params });
        if (sql.includes('COUNT(*)')) return { rows: [{ total: '1' }], rowCount: 1 };
        return { rows: [row], rowCount: 1 };
      },
    };
    setPoolForTest(pool as never);

    const app = express();
    app.use('/gps-logs', gpsLogsRouter);
    const server = app.listen(0);

    try {
      const address = server.address();
      assert.ok(address && typeof address === 'object');
      const response = await fetch(
        `http://127.0.0.1:${address.port}/gps-logs/no-to?page=1&pageSize=25&vehicleId=${row.vehicle_id}&tripDate=2026-07-29`,
      );
      const body = await response.json() as {
        success: boolean;
        total: number;
        data: Array<{ id: string; originAddress: string }>;
      };

      assert.equal(response.status, 200);
      assert.equal(body.success, true);
      assert.equal(body.total, 1);
      assert.equal(body.data[0]?.id, row.id);
      assert.equal(body.data[0]?.originAddress, 'Actual origin');
      assert.match(queries[0]?.sql ?? '', /parent_trip_id IS NULL/);
      assert.match(queries[0]?.sql ?? '', /vehicle_id = \$1/);
      assert.match(queries[0]?.sql ?? '', /trip_date = \$2::date/);
      assert.deepEqual(queries[1]?.params, [row.vehicle_id, '2026-07-29', 25, 0]);
      assert.match(queries[1]?.sql ?? '', /substring\(n\.no_to_record_no FROM '\(\[0-9\]\+\)\$'\)/);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
