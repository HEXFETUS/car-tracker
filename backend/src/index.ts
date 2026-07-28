import app from './app.js';
import { ENABLE_INTERNAL_SCHEDULER, PORT } from './config/env.js';
import { startScheduler } from './services/scheduler.js';

const server = app.listen(PORT, () => {
  console.log(`🚗 Car Tracker API running on http://localhost:${PORT}`);

  // ── Start the fleet sync scheduler ─────────────────────────────
  // Automatically runs syncFleetAndAlert() every SYNC_INTERVAL_SECONDS
  // to fetch Cartrack telemetry, detect state changes, and dispatch
  // Telegram alerts for any vehicle activity.
  if (ENABLE_INTERNAL_SCHEDULER) {
    startScheduler();
  } else {
    console.log('[scheduler] Internal interval disabled; expecting the protected cron endpoint to trigger sync');
  }
});

server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error(
      `[server] Port ${PORT} is already in use. Stop the existing backend process or set PORT to another value.`,
    );
    process.exit(1);
  }

  throw error;
});
