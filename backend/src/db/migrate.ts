#!/usr/bin/env tsx
// ── Database Migration Runner ─────────────────────────────────
//
// Applies all pending `.sql` migration files from
// `backend/src/db/migrations/` in numeric order against the
// database configured in `DATABASE_URL`.
//
// Usage:
//   pnpm --filter car-tracker-backend exec tsx src/db/migrate.ts
//
// Each migration is run inside its own transaction.  A tracking
// table `_migrations` records which files have already been
// applied, making the runner idempotent.

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, 'migrations');
const TRACKING_TABLE = '_migrations';

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('FATAL: DATABASE_URL environment variable is not set.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl });

  try {
    // 1. Ensure the tracking table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "${TRACKING_TABLE}" (
        id          SERIAL PRIMARY KEY,
        filename    TEXT NOT NULL UNIQUE,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        md5         TEXT
      );
    `);

    // 2. List already-applied migrations
    const { rows: appliedRows } = await pool.query(
      `SELECT filename FROM "${TRACKING_TABLE}" ORDER BY filename`,
    );
    const applied = new Set(appliedRows.map((r: any) => r.filename));

    // 3. Read migration files sorted numerically
    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    let pending = 0;

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`⏭  SKIP  ${file}  (already applied)`);
        continue;
      }

      const filePath = path.join(MIGRATIONS_DIR, file);
      const sql = fs.readFileSync(filePath, 'utf-8');

      // Compute a quick checksum for audit
      const crypto = await import('node:crypto');
      const md5 = crypto.createHash('md5').update(sql).digest('hex');

      console.log(`⚡ APPLY ${file} ...`);

      // Run inside a transaction
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(
          `INSERT INTO "${TRACKING_TABLE}" (filename, md5) VALUES ($1, $2)`,
          [file, md5],
        );
        await client.query('COMMIT');
        console.log(`✅ DONE  ${file}`);
        pending += 1;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    if (pending === 0) {
      console.log('✅ No pending migrations — database is up to date.');
    } else {
      console.log(`✅ Applied ${pending} migration(s) successfully.`);
    }
  } catch (error) {
    console.error('Migration failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();