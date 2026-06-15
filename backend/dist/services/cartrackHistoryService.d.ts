export interface CartrackHistoryPoint {
    start_timestamp?: string;
    end_timestamp?: string;
    start_time?: string;
    end_time?: string;
    startTime?: string;
    endTime?: string;
    event_time?: string;
    event_ts?: string;
    timestamp?: string;
    latitude?: number;
    longitude?: number;
    speed?: number;
    speed_kph?: number;
    ignition?: boolean | string | number;
    location?: string;
    location_name?: string;
    address?: string;
    street?: string;
    start_location?: string;
    end_location?: string;
    startLocation?: string;
    endLocation?: string;
    origin?: string;
    destination?: string;
    trip_distance?: number;
    tripDistance?: number;
    distance?: number;
    duration?: number;
    driving_time?: number;
    idling_time?: number;
    engine_hours?: number;
    engineHours?: number;
    odometer?: number;
    start_odometer?: number;
    end_odometer?: number;
    distance_km?: number;
    fuel_level?: number;
    fuelLevel?: number;
    [key: string]: unknown;
}
export interface TransformedTripData {
    departureTimeGps: string | null;
    arrivalTimeGps: string | null;
    gpsDistanceKm: number;
    engineHours: number;
    maxSpeedKph: number;
    originGpsStartPoint: string;
    destinationGpsEndPoint: string;
    actualRouteRoadTaken: string;
    tripStatus: string;
}
interface RawVehicle {
    [key: string]: unknown;
}
export declare function getFleetVehicles(): Promise<RawVehicle[]>;
export declare function resolveCartrackUnitId(plateNumber: string): Promise<{
    unitId: string;
    vehicleId: string;
    plateNumber: string;
} | null>;
export declare function fetchCartrackVehicleHistory(unitId: string, dateStr: string, plateNumber?: string): Promise<CartrackHistoryPoint[]>;
export declare function transformHistoryToTrip(points: CartrackHistoryPoint[], plateNumber: string, dateStr: string): TransformedTripData;
export declare function transformHistoryToTrips(points: CartrackHistoryPoint[], plateNumber: string, dateStr: string): TransformedTripData[];
export {};
//# sourceMappingURL=cartrackHistoryService.d.ts.map