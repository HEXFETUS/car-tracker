#!/usr/bin/env tsx
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('FATAL: DATABASE_URL environment variable is not set.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl });

  try {
    // Mark migration 038 as applied (skip it since fleet_trip_history table doesn't exist)
    await pool.query(
      `INSERT INTO _migrations (filename, md5) VALUES ($1, $2) ON CONFLICT (filename) DO NOTHING`,
      ['038_drop_fleet_trip_history.sql', 'skipped'],
    );
    console.log('✅ Marked 038 as skipped');

    // Run migration 039 directly
    const sqlPath = path.resolve(__dirname, 'migrations', '039_add_active_trip_id_to_gps_telemetry.sql');
    const sql = fs.readFileSync(sqlPath, 'utf-8');
    await pool.query(sql);
    console.log('✅ Migration 039 applied successfully');

    // Record migration 039
    const crypto = await import('node:crypto');
    const md5 = crypto.createHash('md5').update(sql).digest('hex');
    await pool.query(
      `INSERT INTO _migrations (filename, md5) VALUES ($1, $2) ON CONFLICT (filename) DO NOTHING`,
      ['039_add_active_trip_id_to_gps_telemetry.sql', md5],
    );
    console.log('✅ Recorded migration 039 in tracking table');
  } catch (err) {
    console.error('Error:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();