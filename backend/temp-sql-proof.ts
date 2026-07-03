import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const result = await pool.query(`
    SELECT active_trip_id, vehicle_id, trip_type, departure_time_gps, arrival_time_gps
    FROM gps_trip_logs
    WHERE trip_date = '2026-07-03'
    ORDER BY departure_time_gps DESC
  `);
  
  console.log('active_trip_id | vehicle_id | trip_type | departure_time_gps | arrival_time_gps');
  console.log('-'.repeat(120));
  for (const row of result.rows) {
    console.log(
      (row.active_trip_id ?? 'NULL').padEnd(36) + ' | ' +
      row.vehicle_id.substring(0, 8) + '... | ' +
      (row.trip_type ?? 'NULL').padEnd(9) + ' | ' +
      (row.departure_time_gps ? new Date(row.departure_time_gps).toISOString() : 'NULL').padEnd(24) + ' | ' +
      (row.arrival_time_gps ? new Date(row.arrival_time_gps).toISOString() : 'NULL')
    );
  }
  
  await pool.end();
}

main().catch(err => { console.error(err.message); process.exit(1); });