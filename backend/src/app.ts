import 'dotenv/config';
import express, { type Express } from 'express';
import cors from 'cors';
import carsRouter from './routes/cars.js';
import vehiclesRouter from './routes/vehicles.js';
import driversRouter from './routes/drivers.js';
import travelOrdersRouter from './routes/travel-orders.js';
import gpsLogsRouter from './routes/gps-logs.js';
import cronRouter from './routes/cron.js';
import usersRouter from './routes/users.js';
import authRouter from './routes/auth.js';

const app: Express = express();

app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/cars', carsRouter);
app.use('/api/vehicles', vehiclesRouter);
app.use('/api/drivers', driversRouter);
app.use('/api/travel-orders', travelOrdersRouter);
app.use('/api/gps-logs', gpsLogsRouter);
app.use('/api/cron', cronRouter);
app.use('/api/users', usersRouter);
app.use('/api/auth', authRouter);

export default app;
