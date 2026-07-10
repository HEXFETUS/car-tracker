import 'dotenv/config';
import { getPool } from './src/db/db.js';

async function main() {
  const pool = getPool();
  try {
    const exists = await pool.query("SELECT to_regclass('public.gps_alerts') AS t");
    console.log('gps_alerts regclass:', exists.rows[0]);

    const cols = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'gps_alerts' ORDER BY column_name");
    console.log('gps_alerts columns:', cols.rows.map((x: any) => x.column_name));

    const cnt = await pool.query('SELECT COUNT(*) AS cnt FROM gps_alerts');
    console.log('gps_alerts count:', cnt.rows[0]);
  } catch (e) {
    console.error('ERR', (e as Error).message);
  } finally {
    await pool.end();
  }
}

main();