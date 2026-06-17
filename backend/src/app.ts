import 'dotenv/config';
import express, { type Application } from 'express';
import cors from 'cors';
import vehiclesRouter from './routes/vehicles.js';
import driversRouter from './routes/drivers.js';
import travelOrdersRouter from './routes/travel-orders.js';
import gpsLogsRouter from './routes/gps-logs.js';
import cronRouter from './routes/cron.js';
import usersRouter from './routes/users.js';
import authRouter from './routes/auth.js';
import settingsRouter from './routes/settings.js';
import reportsRouter from './routes/reports.js';

const app: Application = express();

app.use(cors());
app.use(express.json());
app.use((req, _res, next) => {
  console.log(`[express] ${req.method} ${req.originalUrl}`);
  next();
});

app.get(['/api/health', '/health'], (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use(['/api/vehicles', '/vehicles'], vehiclesRouter);
app.use(['/api/drivers', '/drivers'], driversRouter);
app.use(['/api/travel-orders', '/travel-orders'], travelOrdersRouter);
app.use(['/api/gps-logs', '/gps-logs'], gpsLogsRouter);
app.use(['/api/cron', '/cron'], cronRouter);
app.use(['/api/users', '/users'], usersRouter);
app.use(['/api/auth', '/auth'], authRouter);
app.use(['/api/settings', '/settings'], settingsRouter);
app.use(['/api/reports', '/reports'], reportsRouter);

app.all(['/api/debug/routes', '/debug/routes'], (_req, res) => {
  res.json({ ok: true, message: 'debug route reached' });
});

app.use((_req, res) => {
  res.status(404).json({ success: false, data: null, error: 'API route not found' });
});

export default app;
