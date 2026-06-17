import app from './app.js';
import { PORT } from './config/env.js';
import { startScheduler } from './services/scheduler.js';

// ── Start the fleet sync scheduler ─────────────────────────────
// Automatically runs syncFleetAndAlert() every SYNC_INTERVAL_SECONDS
// to fetch Cartrack telemetry, detect state changes, and dispatch
// Telegram alerts for any vehicle activity.
startScheduler();

app.listen(PORT, () => {
  console.log(`🚗 Car Tracker API running on http://localhost:${PORT}`);
});
