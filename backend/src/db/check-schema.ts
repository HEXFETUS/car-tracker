/**
 * Diagnostic script to check gps_telemetry table schema and relations
 * 
 * Run with: npx tsx src/db/check-schema.ts
 */

import { getPool } from '../db/db.js';

async function checkSchema() {
  const pool = getPool();
  
  console.log('=== Checking gps_telemetry table schema ===\n');
  
  // 1. Check if table exists
  const tableExists = await pool.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'gps_telemetry'
    );
  `);
  console.log('Table exists:', tableExists.rows[0].exists);
  
  // 2. Check columns
  const columns = await pool.query(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'gps_telemetry'
    ORDER BY ordinal_position;
  `);
  console.log('\nColumns:');
  columns.rows.forEach((col: { column_name: string; data_type: string; is_nullable: string }) => {
    console.log(`  - ${col.column_name} (${col.data_type}, nullable: ${col.is_nullable})`);
  });
  
  // 3. Check foreign keys
  const fks = await pool.query(`
    SELECT
      tc.constraint_name,
      kcu.column_name,
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_name = 'gps_telemetry';
  `);
  console.log('\nForeign Keys:');
  if (fks.rows.length === 0) {
    console.log('  None found');
  } else {
    fks.rows.forEach((fk: { column_name: string; foreign_table_name: string; foreign_column_name: string }) => {
      console.log(`  - ${fk.column_name} → ${fk.foreign_table_name}.${fk.foreign_column_name}`);
    });
  }
  
  // 4. Check RLS policies
  const policies = await pool.query(`
    SELECT policyname, permissive, roles, cmd, qual, with_check_expression
    FROM pg_policies
    WHERE tablename = 'gps_telemetry';
  `);
  console.log('\nRLS Policies:');
  if (policies.rows.length === 0) {
    console.log('  None found');
  } else {
    policies.rows.forEach((p: { policyname: string; cmd: string; roles: string[] }) => {
      console.log(`  - ${p.policyname}`);
      console.log(`    Command: ${p.cmd}, Roles: ${p.roles.join(', ')}`);
    });
  }
  
  // 5. Check RLS status
  const rlsEnabled = await pool.query(`
    SELECT relname, relrowsecurity
    FROM pg_class
    WHERE relname = 'gps_telemetry';
  `);
  console.log('\nRLS Enabled:', rlsEnabled.rows[0]?.relrowsecurity || false);
  
  // 6. Try a test query
  console.log('\n=== Test Query ===');
  try {
    const result = await pool.query('SELECT COUNT(*) as count FROM gps_telemetry LIMIT 1');
    console.log('✅ Query successful, count:', result.rows[0].count);
  } catch (err) {
    console.log('❌ Query failed:', (err as Error).message);
  }
  
  await pool.end();
  console.log('\n=== Check complete ===');
}

checkSchema().catch(err => {
  console.error('Schema check failed:', err);
  process.exit(1);
});