import 'dotenv/config';
import express, { type Application } from 'express';
import cors from 'cors';
import multer from 'multer';
import vehiclesRouter from './routes/vehicles.js';
import driversRouter from './routes/drivers.js';
import travelOrdersRouter from './routes/travel-orders.js';
import publicTravelOrdersRouter from './routes/public-travel-orders.js';
import gpsLogsRouter from './routes/gps-logs.js';
import cronRouter from './routes/cron.js';
import usersRouter from './routes/users.js';
import authRouter from './routes/auth.js';
import settingsRouter from './routes/settings.js';
import reportsRouter from './routes/reports.js';
import maintenanceRouter from './routes/maintenance.js';
import adminSyncRouter from './routes/admin-sync.js';
import dashboardRouter from './routes/dashboard.js';
import notificationsRouter from './routes/notifications.js';
import searchRouter from './routes/search.js';
import vehicleDetailRouter from './routes/vehicle-detail.js';
import { requireRole } from './middleware/auth.js';

const app: Application = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use((req, _res, next) => {
  console.log(`[express] ${req.method} ${req.originalUrl}`);
  next();
});

app.get(['/api/health', '/health'], (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Vehicle detail must be registered before the generic vehicles router
// to avoid /:id matching /:id/detail
app.use(['/api/vehicles', '/vehicles'], vehicleDetailRouter);
app.use(['/api/vehicles', '/vehicles'], vehiclesRouter);
app.use(['/api/drivers', '/drivers'], driversRouter);
// Public travel orders — no auth required (for unauthenticated user-to requests)
app.use(['/api/public/travel-orders', '/public/travel-orders'], publicTravelOrdersRouter);
app.use(['/api/travel-orders', '/travel-orders'], requireRole, travelOrdersRouter);
app.use(['/api/gps-logs', '/gps-logs'], gpsLogsRouter);
app.use(['/api/cron', '/cron'], cronRouter);
app.use(['/api/users', '/users'], usersRouter);
app.use(['/api/auth', '/auth'], authRouter);
app.use(['/api/settings', '/settings'], requireRole, settingsRouter);
app.use(['/api/reports', '/reports'], requireRole, reportsRouter);
app.use(['/api/maintenance', '/maintenance'], maintenanceRouter);
app.use(['/api/admin/sync-tracking-history', '/admin/sync-tracking-history'], adminSyncRouter);
app.use(['/api/dashboard', '/dashboard'], dashboardRouter);
app.use(['/api/notifications', '/notifications'], notificationsRouter);
app.use(['/api/search', '/search'], searchRouter);

app.all(['/api/debug/routes', '/debug/routes'], (_req, res) => {
  res.json({ ok: true, message: 'debug route reached' });
});

app.use((_req, res) => {
  res.status(404).json({ success: false, data: null, error: 'API route not found' });
});

export default app;
