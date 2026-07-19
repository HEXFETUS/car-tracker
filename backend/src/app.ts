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
import {
  ALL_ROLES,
  OPERATIONAL_ROLES,
  authorizeReadWrite,
  loadSession,
  requireAuthentication,
  requireRoles,
} from './middleware/auth.js';
import { isAllowedOrigin, protectCookieAuthenticatedOrigin } from './middleware/origin.js';
import { generalRateLimit } from './middleware/rate-limit.js';

const app: Application = express();
const upload = multer({ storage: multer.memoryStorage() });

app.set('trust proxy', 1);
app.use(cors({
  credentials: true,
  origin(origin, callback) {
    if (!origin || isAllowedOrigin(origin)) callback(null, true);
    else callback(null, false);
  },
  allowedHeaders: ['Content-Type'],
}));
app.use(express.json({ limit: '10mb' }));
app.use((req, _res, next) => {
  console.log(`[express] ${req.method} ${req.originalUrl}`);
  next();
});
app.use(protectCookieAuthenticatedOrigin);
app.use(loadSession);
app.use(generalRateLimit);

app.get(['/api/health', '/health'], (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Vehicle detail must be registered before the generic vehicles router
// to avoid /:id matching /:id/detail
app.use(['/api/vehicles', '/vehicles'], requireAuthentication, authorizeReadWrite(OPERATIONAL_ROLES, OPERATIONAL_ROLES), vehicleDetailRouter);
app.use(['/api/vehicles', '/vehicles'], requireAuthentication, authorizeReadWrite(OPERATIONAL_ROLES, OPERATIONAL_ROLES), vehiclesRouter);
app.use(['/api/drivers', '/drivers'], requireAuthentication, authorizeReadWrite(OPERATIONAL_ROLES, OPERATIONAL_ROLES), driversRouter);
// Public travel orders — no auth required (for unauthenticated user-to requests)
app.use(['/api/public/travel-orders', '/public/travel-orders'], publicTravelOrdersRouter);
app.use(['/api/travel-orders', '/travel-orders'], requireAuthentication, authorizeReadWrite(ALL_ROLES, OPERATIONAL_ROLES), travelOrdersRouter);
app.use(['/api/gps-logs', '/gps-logs'], requireAuthentication, authorizeReadWrite(OPERATIONAL_ROLES, OPERATIONAL_ROLES), gpsLogsRouter);
app.use(['/api/cron', '/cron'], cronRouter);
app.use(['/api/users', '/users'], requireAuthentication, requireRoles('SUPERADMIN', 'ADMIN'), usersRouter);
app.use(['/api/auth', '/auth'], authRouter);
app.use(['/api/settings', '/settings'], requireAuthentication, requireRoles('SUPERADMIN'), settingsRouter);
app.use(['/api/reports', '/reports'], requireAuthentication, requireRoles('SUPERADMIN', 'ADMIN', 'VIEWER'), reportsRouter);
app.use(['/api/maintenance', '/maintenance'], requireAuthentication, authorizeReadWrite(OPERATIONAL_ROLES, OPERATIONAL_ROLES), maintenanceRouter);
app.use(['/api/admin', '/admin'], requireAuthentication, requireRoles('SUPERADMIN'), adminSyncRouter);
app.use(['/api/dashboard', '/dashboard'], requireAuthentication, requireRoles(...ALL_ROLES), dashboardRouter);
app.use(['/api/notifications', '/notifications'], requireAuthentication, requireRoles(...ALL_ROLES), notificationsRouter);
app.use(['/api/search', '/search'], requireAuthentication, requireRoles(...ALL_ROLES), searchRouter);

app.all(['/api/debug/routes', '/debug/routes'], requireAuthentication, requireRoles('SUPERADMIN'), (_req, res) => {
  res.json({ ok: true, message: 'debug route reached' });
});

app.use((_req, res) => {
  res.status(404).json({ success: false, data: null, error: 'API route not found' });
});

export default app;
