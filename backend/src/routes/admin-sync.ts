import express, { type Request, type Response, type Router as ExpressRouter } from 'express';
import type { ApiResponse } from '@car-tracker/shared';
import { syncTrackingHistory, type TrackingHistorySyncResult } from '../services/trackingHistorySyncService.js';
import { discoverFleetHistoryEndpoints, resolveCartrackUnitId } from '../services/cartrackHistoryService.js';

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

// GET /api/admin/discover-fleet-history?plate=KAR6558&date=2026-06-17
// Probes all known Cartrack endpoints for the given vehicle/date and logs
// which endpoints return fleet trip history rows (Time, Status, Events,
// Location, Latitude, Longitude).
router.get('/discover-fleet-history', async (req: Request, res: Response) => {
  const startTime = Date.now();

  try {
    const plate = String(req.query.plate || req.query.plateNumber || '').trim().toUpperCase();
    const dateStr = String(req.query.date || '').trim();

    if (!plate) {
      res.status(400).json({
        success: false,
        error: 'Missing required query parameter: plate (e.g. KAR6558)',
        elapsed_seconds: (Date.now() - startTime) / 1000,
      } as ApiResponse<null> & { elapsed_seconds: number });
      return;
    }

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateStr || !dateRegex.test(dateStr)) {
      res.status(400).json({
        success: false,
        error: 'Missing or invalid query parameter: date (expected YYYY-MM-DD)',
        elapsed_seconds: (Date.now() - startTime) / 1000,
      } as ApiResponse<null> & { elapsed_seconds: number });
      return;
    }

    // Resolve Cartrack unit ID
    const unitInfo = await resolveCartrackUnitId(plate);
    if (!unitInfo) {
      res.status(404).json({
        success: false,
        error: `Could not resolve Cartrack unit ID for plate ${plate}`,
        elapsed_seconds: (Date.now() - startTime) / 1000,
      } as ApiResponse<null> & { elapsed_seconds: number });
      return;
    }

    // Run discovery (logs to console)
    await discoverFleetHistoryEndpoints(unitInfo.unitId, plate, dateStr);

    const elapsed = (Date.now() - startTime) / 1000;

    res.json({
      success: true,
      data: {
        plate,
        date: dateStr,
        unitId: unitInfo.unitId,
        message: 'Discovery complete. Check server logs for endpoint results.',
      },
      message: `Fleet history endpoint discovery completed for ${plate} on ${dateStr}. Review server logs.`,
      elapsed_seconds: elapsed,
    } as ApiResponse<Record<string, unknown>> & { elapsed_seconds: number });
  } catch (error) {
    const elapsed = (Date.now() - startTime) / 1000;
    const message = error instanceof Error ? error.message : String(error);
    console.error('GET /api/admin/discover-fleet-history error:', message);
    res.status(500).json({
      success: false,
      error: message,
      elapsed_seconds: elapsed,
    } as ApiResponse<null> & { elapsed_seconds: number });
  }
});
export default router;
