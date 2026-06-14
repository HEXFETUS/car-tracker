import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import carsRouter from './routes/cars.js';
import vehiclesRouter from './routes/vehicles.js';
import driversRouter from './routes/drivers.js';
import travelOrdersRouter from './routes/travel-orders.js';
import gpsLogsRouter from './routes/gps-logs.js';
import cronRouter from './routes/cron.js';
import usersRouter from './routes/users.js';
import authRouter from './routes/auth.js';
import { PORT } from './config/env.js';
const app = express();
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
app.listen(PORT, () => {
    console.log(`🚗 Car Tracker API running on http://localhost:${PORT}`);
});
//# sourceMappingURL=index.js.map