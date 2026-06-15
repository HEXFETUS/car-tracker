export interface GpsLogInsertData {
    gpsRecordNo: string;
    tripDate: string;
    vehicleId: string;
    driverId: string;
    originGpsStartPoint: string;
    destinationGpsEndPoint: string;
    actualRouteRoadTaken: string;
    departureTimeGps: string | null;
    arrivalTimeGps: string | null;
    gpsDistanceKm: number;
    engineHours: number;
    maxSpeedKph: number;
    tripStatusGps: string;
    travelOrderId: string | null;
    toStatusAuto: string | null;
    anomalyFlag: boolean;
    notesRemarks: string | null;
}
export interface ApprovedTravelOrderResult {
    id: string;
    vehicle_id: string;
    driver_id: string;
    status: string;
}
/**
 * Find a vehicle record by its plate number (case-insensitive).
 * Returns the vehicle UUID or null if not found.
 */
export declare function findVehicleByPlate(plateNumber: string): Promise<string | null>;
/**
 * Find an active/approved travel order assigned to the given vehicle.
 * Returns the travel order record or null.
 */
export declare function findActiveTravelOrder(vehicleId: string): Promise<{
    id: string;
    status: string;
    driver_id: string | null;
} | null>;
/**
 * Find a travel order that is APPROVED, ACTIVE, or COMPLETED for a
 * specific vehicle on a specific date. The date check uses the
 * scheduled_departure and scheduled_arrival range.
 *
 * Returns the matched travel order record or null if no valid
 * travel order exists for that vehicle on that date.
 */
export declare function findApprovedTravelOrderForDate(vehicleId: string, dateStr: string): Promise<ApprovedTravelOrderResult | null>;
/**
 * Find a driver by their full name (case-insensitive, partial match).
 * Returns the driver UUID or null if not found.
 */
export declare function findDriverByName(driverName: string): Promise<string | null>;
/**
 * Insert a single GPS trip log record into the database.
 * Returns the inserted row or throws on failure.
 */
export declare function saveGpsTripLog(logData: GpsLogInsertData): Promise<{
    id: string;
}>;
/**
 * Resolve all relational IDs for a GPS log entry.
 * Runs vehicle lookup, travel order lookup, and driver lookup in parallel.
 */
export declare function resolveGpsLogRelations(params: {
    plateNumber: string;
    driverName: string | null;
}): Promise<{
    vehicleId: string | null;
    travelOrderId: string | null;
    toStatusAuto: string | null;
    driverId: string | null;
}>;
//# sourceMappingURL=gpsLogService.d.ts.map