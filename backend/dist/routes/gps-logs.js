import { Router } from 'express';
import { getPool } from '../db/db.js';
const router = Router();
// GET /api/gps-logs — List all with LEFT JOINs for enrichment
router.get('/', async (req, res) => {
    try {
        const pool = getPool();
        const page = Math.max(1, Number(req.query.page) || 1);
        const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
        const offset = (page - 1) * pageSize;
        // Build WHERE clause from optional filters
        const conditions = [];
        const params = [];
        if (req.query.vehicleId) {
            conditions.push(`g.vehicle_id = $${params.length + 1}`);
            params.push(req.query.vehicleId);
        }
        if (req.query.driverId) {
            conditions.push(`g.driver_id = $${params.length + 1}`);
            params.push(req.query.driverId);
        }
        if (req.query.tripDate) {
            conditions.push(`g.trip_date = $${params.length + 1}`);
            params.push(req.query.tripDate);
        }
        if (req.query.anomalyFlag !== undefined) {
            conditions.push(`g.anomaly_flag = $${params.length + 1}`);
            params.push(req.query.anomalyFlag === 'true');
        }
        const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
        // Count total matching rows
        const countResult = await pool.query(`SELECT COUNT(*) AS total FROM gps_trip_logs g ${whereClause}`, params);
        const total = parseInt(countResult.rows[0]?.total || '0', 10);
        // Fetch paginated data with joins
        const dataParams = [...params, pageSize, offset];
        const dataResult = await pool.query(`SELECT
        g.*,
        v.plate_number,
        d.full_name AS driver_full_name,
        t_o.to_number AS travel_order_to_number
      FROM gps_trip_logs g
      LEFT JOIN vehicles      v   ON v.id = g.vehicle_id
      LEFT JOIN drivers       d   ON d.id = g.driver_id
      LEFT JOIN travel_orders t_o ON t_o.id = g.travel_order_id
      ${whereClause}
      ORDER BY g.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, dataParams);
        const data = dataResult.rows.map(mapRow);
        const response = {
            success: true,
            data,
            total,
            page,
            pageSize,
            message: 'GPS logs retrieved successfully',
        };
        res.json(response);
    }
    catch (error) {
        console.error('GET /api/gps-logs error:', error.message);
        res.status(500).json({ success: false, data: null, error: 'Database error' });
    }
});
// GET /api/gps-logs/:id
router.get('/:id', async (req, res) => {
    try {
        const pool = getPool();
        const result = await pool.query(`SELECT
        g.*,
        v.plate_number,
        d.full_name AS driver_full_name,
        t_o.to_number AS travel_order_to_number
      FROM gps_trip_logs g
      LEFT JOIN vehicles      v   ON v.id = g.vehicle_id
      LEFT JOIN drivers       d   ON d.id = g.driver_id
      LEFT JOIN travel_orders t_o ON t_o.id = g.travel_order_id
      WHERE g.id = $1`, [req.params.id]);
        if (result.rows.length === 0) {
            res.status(404).json({ success: false, data: null, error: 'GPS log not found' });
            return;
        }
        res.json({ success: true, data: mapRow(result.rows[0]) });
    }
    catch (error) {
        console.error('GET /api/gps-logs/:id error:', error.message);
        res.status(500).json({ success: false, data: null, error: 'Database error' });
    }
});
// POST /api/gps-logs — Create a new GPS log
router.post('/', async (req, res) => {
    const body = req.body;
    const requiredFields = ['gpsRecordNo', 'tripDate', 'vehicleId', 'driverId', 'originGpsStartPoint', 'destinationGpsEndPoint', 'tripStatusGps'];
    for (const field of requiredFields) {
        if (!body[field]) {
            res.status(400).json({
                success: false,
                data: null,
                error: `Missing required field: ${field}`,
            });
            return;
        }
    }
    const validStatuses = ['departed', 'en-route', 'arrived', 'cancelled', 'completed'];
    if (!validStatuses.includes(body.tripStatusGps)) {
        res.status(400).json({
            success: false,
            data: null,
            error: `Invalid tripStatusGps. Must be one of: ${validStatuses.join(', ')}`,
        });
        return;
    }
    try {
        const pool = getPool();
        const result = await pool.query(`INSERT INTO gps_trip_logs
        (gps_record_no, trip_date, vehicle_id, driver_id,
         origin_gps_start_point, destination_gps_end_point,
         actual_route_road_taken, departure_time_gps, arrival_time_gps,
         gps_distance_km, engine_hours, max_speed_kph,
         trip_status_gps, travel_order_id, to_status_auto,
         anomaly_flag, notes_remarks)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       RETURNING *`, [
            body.gpsRecordNo, body.tripDate, body.vehicleId, body.driverId,
            body.originGpsStartPoint, body.destinationGpsEndPoint,
            body.actualRouteRoadTaken || '', body.departureTimeGps || null, body.arrivalTimeGps || null,
            Number(body.gpsDistanceKm) || 0, Number(body.engineHours) || 0, Number(body.maxSpeedKph) || 0,
            body.tripStatusGps, body.travelOrderId || null, body.toStatusAuto || null,
            Boolean(body.anomalyFlag), body.notesRemarks || null,
        ]);
        res.status(201).json({
            success: true,
            data: mapRow(result.rows[0]),
            message: 'GPS log created successfully',
        });
    }
    catch (error) {
        console.error('POST /api/gps-logs error:', error.message);
        res.status(500).json({ success: false, data: null, error: 'Database error' });
    }
});
// PATCH /api/gps-logs/:id — Update allowed fields
router.patch('/:id', async (req, res) => {
    const allowedFields = [
        'anomaly_flag', 'notes_remarks', 'trip_status_gps', 'actual_route_road_taken',
        'arrival_time_gps', 'gps_distance_km', 'engine_hours', 'max_speed_kph',
        'to_status_auto', 'travel_order_id',
    ];
    const updates = [];
    const values = [];
    let idx = 1;
    for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
            updates.push(`${field} = $${idx++}`);
            values.push(req.body[field]);
        }
    }
    if (updates.length === 0) {
        res.status(400).json({ success: false, data: null, error: 'No valid fields to update' });
        return;
    }
    try {
        const pool = getPool();
        values.push(req.params.id);
        const result = await pool.query(`UPDATE gps_trip_logs SET ${updates.join(', ')} WHERE id = $${idx}
       RETURNING *`, values);
        if (result.rows.length === 0) {
            res.status(404).json({ success: false, data: null, error: 'GPS log not found' });
            return;
        }
        res.json({ success: true, data: mapRow(result.rows[0]), message: 'GPS log updated successfully' });
    }
    catch (error) {
        console.error('PATCH /api/gps-logs/:id error:', error.message);
        res.status(500).json({ success: false, data: null, error: 'Database error' });
    }
});
function mapRow(row) {
    return {
        id: row.id,
        gpsRecordNo: row.gps_record_no,
        tripDate: row.trip_date,
        vehicleId: row.vehicle_id,
        driverId: row.driver_id,
        originGpsStartPoint: row.origin_gps_start_point,
        destinationGpsEndPoint: row.destination_gps_end_point,
        actualRouteRoadTaken: row.actual_route_road_taken,
        departureTimeGps: row.departure_time_gps,
        arrivalTimeGps: row.arrival_time_gps,
        gpsDistanceKm: row.gps_distance_km,
        engineHours: row.engine_hours,
        maxSpeedKph: row.max_speed_kph,
        tripStatusGps: row.trip_status_gps,
        travelOrderId: row.travel_order_id,
        toStatusAuto: row.to_status_auto,
        anomalyFlag: row.anomaly_flag,
        notesRemarks: row.notes_remarks,
        vehiclePlateNo: row.plate_number ?? 'Unknown',
        driverName: row.driver_full_name ?? 'Unknown',
        toNumber: row.travel_order_to_number ?? null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
export default router;
//# sourceMappingURL=gps-logs.js.map