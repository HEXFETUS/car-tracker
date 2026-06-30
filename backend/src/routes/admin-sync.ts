import express, { type Request, type Response, type Router as ExpressRouter } from 'express';
import type { ApiResponse } from '@car-tracker/shared';
import { syncTrackingHistory, type TrackingHistorySyncResult } from '../services/trackingHistorySyncService.js';
import { resolveCartrackUnitId } from '../services/cartrackHistoryService.js';

const router: ExpressRouter = express.Router();

// POST /api/admin/sync-tracking-history
// Triggers full fleet tracking-history sync for a date range.
// Reconstructs trips from raw GPS breadcrumbs, detects return trips,
// matches to Travel Orders, and persists to gps_trip_logs.
router.post('/sync-tracking-history', async (req: Request, res: Response) => {
  const startTime = Date.now();

  try {
    const { fromDate, toDate } = req.body as { fromDate?: string; toDate?: string };

    if (!fromDate || !toDate) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: fromDate and toDate (YYYY-MM-DD)',
        elapsed_seconds: (Date.now() - startTime) / 1000,
      } as ApiResponse<null> & { elapsed_seconds: number });
      return;
    }

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(fromDate) || !dateRegex.test(toDate)) {
      res.status(400).json({
        success: false,
        error: 'Invalid date format. Expected YYYY-MM-DD.',
        elapsed_seconds: (Date.now() - startTime) / 1000,
      } as ApiResponse<null> & { elapsed_seconds: number });
      return;
    }

    if (new Date(fromDate) > new Date(toDate)) {
      res.status(400).json({
        success: false,
        error: 'fromDate must be earlier than or equal to toDate.',
        elapsed_seconds: (Date.now() - startTime) / 1000,
      } as ApiResponse<null> & { elapsed_seconds: number });
      return;
    }

    const result: TrackingHistorySyncResult = await syncTrackingHistory(fromDate, toDate);
    const elapsed = (Date.now() - startTime) / 1000;

    res.json({
      success: true,
      data: result,
      message: `Sync completed: ${result.totalTripsCreated} trips created, ${result.totalTripsFailed} failed across ${result.totalVehiclesProcessed} vehicles.`,
      elapsed_seconds: elapsed,
    } as ApiResponse<TrackingHistorySyncResult> & { elapsed_seconds: number });
  } catch (error) {
    const elapsed = (Date.now() - startTime) / 1000;
    const message = error instanceof Error ? error.message : String(error);
    console.error('POST /api/admin/sync-tracking-history error:', message);
    res.status(500).json({
      success: false,
      error: message,
      elapsed_seconds: elapsed,
    } as ApiResponse<null> & { elapsed_seconds: number });
  }
});

export default router;
