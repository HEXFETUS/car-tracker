import express from 'express';
import cors from 'cors';
import carsRouter from './routes/cars.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/cars', carsRouter);

app.listen(PORT, () => {
  console.log(`🚗 Car Tracker API running on http://localhost:${PORT}`);
});