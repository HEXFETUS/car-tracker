// ── Fleet Trip History Routes ─────────────────────────────────
//
// API endpoints for synchronizing, querying, and viewing
// Fleet GPS trip history records.

import express, { type Request, type Response, type Router as ExpressRouter } from 'express';
import { getPool } from '../db/db.js';
import {
  syncFleetTripHistory,
  syncAllVehiclesToday,
  syncAllVehiclesFleetTripHistory,
  queryFleetTripHistory,
  getFleetTripHistoryById,
  type FleetTripHistoryQueryParams,
  type FleetTripHistoryRow,
} from '../services/fleetTripHistorySyncService.js';
import { findVehicleByPlate } from '../services/gpsLogService.js';

const router: ExpressRouter = express.Router();

// ─────────────────────────────────────────────────────────────────
// POST /api/gps-logs/fleet-trip-history/sync
// Synchronize fleet trip history for a vehicle/date with intelligent filtering
// ─────────────────────────────────────────────────────────────────
router.post('/sync', async (req: Request, res: Response) => {
  try {
    const { vehicleId, plateNumber, date } = req.body;

    if (!date) {
      res.status(400).json({
        success: false,
        error: 'Missing required field: date (YYYY-MM-DD)',
      });
      return;
    }

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      res.status(400).json({
        success: false,
        error: 'Invalid date format. Expected YYYY-MM-DD.',
      });
      return;
    }

    let resolvedVehicleId = vehicleId;
    if (!resolvedVehicleId && plateNumber) {
      resolvedVehicleId = await findVehicleByPlate(plateNumber);
    }

    if (!resolvedVehicleId) {
      res.status(400).json({
        success: false,
        error: 'Could not resolve vehicle. Provide either vehicleId or plateNumber.',
      });
      return;
    }

    let resolvedPlateNumber = plateNumber;
    if (!resolvedPlateNumber && resolvedVehicleId) {
      const pool = getPool();
      const result = await pool.query<{ plate_number: string }>(
        `SELECT plate_number FROM vehicles WHERE id = $1 LIMIT 1`,
        [resolvedVehicleId],
      );
      resolvedPlateNumber = result.rows[0]?.plate_number;
    }

    if (!resolvedPlateNumber) {
      res.status(400).json({
        success: false,
        error: 'Could not resolve plate number for the given vehicle.',
      });
      return;
    }

    const result = await syncFleetTripHistory(resolvedVehicleId, resolvedPlateNumber, date);

    if (!result.success) {
      res.status(500).json({
        success: false,
        error: result.message,
      });
      return;
    }

    res.json({
      success: true,
      fetched: result.statistics.fetched,
      saved: result.statistics.saved,
      stationarySkipped: result.statistics.stationarySkipped,
      duplicateSkipped: result.statistics.duplicateSkipped,
      movingSkippedNoLocationChange: result.statistics.movingSkippedNoLocationChange,
      idleSkippedNotMilestone: result.statistics.idleSkippedNotMilestone,
      invalidData: result.statistics.invalidData,
      errors: result.statistics.errors,
      message: result.message,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('POST /api/gps-logs/fleet-trip-history/sync error:', message);
    res.status(500).json({ success: false, error: message });
  }
});

// ─────────────────────────────────────────────────────────────────
// POST /api/gps-logs/fleet-trip-history/auto-sync
// Automatic synchronization of today's fleet trip history for all vehicles.
// ─────────────────────────────────────────────────────────────────
router.post('/auto-sync', async (_req: Request, res: Response) => {
  try {
    const result = await syncAllVehiclesToday();

    if (!result.success) {
      res.status(500).json({
        success: false,
        error: 'Auto sync failed',
        message: result.message,
      });
      return;
    }

    res.json({
      success: true,
      totalVehicles: result.totalVehicles,
      totalFetched: result.totalFetched,
      totalSaved: result.totalSaved,
      totalStationarySkipped: result.totalStationarySkipped,
      totalDuplicateSkipped: result.totalDuplicateSkipped,
      totalMovingSkipped: result.totalMovingSkipped,
      totalIdleSkipped: result.totalIdleSkipped,
      totalInvalidData: result.totalInvalidData,
      totalErrors: result.totalErrors,
      message: result.message,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('POST /api/gps-logs/fleet-trip-history/auto-sync error:', message);
    res.status(500).json({ success: false, error: message });
  }
});

// ─────────────────────────────────────────────────────────────────
// POST /api/gps-logs/fleet-trip-history/sync-date
// Manual synchronization for a user-selected specific date.
// ─────────────────────────────────────────────────────────────────
router.post('/sync-date', async (req: Request, res: Response) => {
  try {
    const { date } = req.body;

    if (!date) {
      res.status(400).json({
        success: false,
        error: 'Missing required field: date (YYYY-MM-DD)',
      });
      return;
    }

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      res.status(400).json({
        success: false,
        error: 'Invalid date format. Expected YYYY-MM-DD.',
      });
      return;
    }

    const result = await syncAllVehiclesFleetTripHistory(date);

    if (!result.success) {
      res.status(500).json({
        success: false,
        error: 'Manual sync failed',
        message: result.message,
      });
      return;
    }

    res.json({
      success: true,
      date,
      totalVehicles: result.totalVehicles,
      totalFetched: result.totalFetched,
      totalSaved: result.totalSaved,
      totalStationarySkipped: result.totalStationarySkipped,
      totalDuplicateSkipped: result.totalDuplicateSkipped,
      totalMovingSkipped: result.totalMovingSkipped,
      totalIdleSkipped: result.totalIdleSkipped,
      totalInvalidData: result.totalInvalidData,
      totalErrors: result.totalErrors,
      message: result.message,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('POST /api/gps-logs/fleet-trip-history/sync-date error:', message);
    res.status(500).json({ success: false, error: message });
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /api/gps-logs/fleet-trip-history
// Query fleet trip history with pagination, filtering, sorting, search
// ─────────────────────────────────────────────────────────────────
router.get('/', async (req: Request, res: Response) => {
  try {
    const params: FleetTripHistoryQueryParams = {
      page: Math.max(1, Number(req.query.page) || 1),
      pageSize: Math.min(100, Math.max(1, Number(req.query.pageSize) || 20)),
      vehicleId: req.query.vehicleId as string | undefined,
      driverId: req.query.driverId as string | undefined,
      travelOrderId: req.query.travelOrderId as string | undefined,
      status: req.query.status as string | undefined,
      dateFrom: req.query.dateFrom as string | undefined,
      dateTo: req.query.dateTo as string | undefined,
      search: req.query.search as string | undefined,
      sortBy: req.query.sortBy as string | undefined,
      sortOrder: (req.query.sortOrder as 'asc' | 'desc') || 'desc',
    };

    const result = await queryFleetTripHistory(params);

    res.json({
      success: true,
      data: result.data,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      message: 'Fleet trip history retrieved successfully',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('GET /api/gps-logs/fleet-trip-history error:', message);
    res.status(500).json({ success: false, data: null, error: message });
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /api/gps-logs/fleet-trip-history/:id
// Get a single fleet trip history record by ID
// ─────────────────────────────────────────────────────────────────
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const record = await getFleetTripHistoryById(req.params.id);

    if (!record) {
      res.status(404).json({
        success: false,
        data: null,
        error: 'Fleet trip history record not found',
      });
      return;
    }

    res.json({
      success: true,
      data: record,
      message: 'Fleet trip history record retrieved successfully',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('GET /api/gps-logs/fleet-trip-history/:id error:', message);
    res.status(500).json({ success: false, data: null, error: message });
  }
});

export default router;