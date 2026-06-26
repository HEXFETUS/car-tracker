export interface Car {
  id: string;
  brand: string;
  model: string;
  year: number;
  color: string;
  price: number;
  mileage?: number;
  fuelType?: 'gasoline' | 'diesel' | 'electric' | 'hybrid';
  transmission?: 'manual' | 'automatic';
  vin: string;
  status: 'available' | 'in-service' | 'sold';
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  username: string;
  role: string;
  avatar?: string;
  createdAt: string;
}

export interface MaintenanceRecord {
  id: string;
  carId: string;
  carName: string;
  serviceType: string;
  cost: number;
  date: string;
  notes?: string;
}

export interface Maintenance {
  id: string;
  vehicleId: string;
  vehiclePlate?: string;
  vehicleName?: string;
  serviceType: string;
  cost: number;
  date: string;
  remarks?: string;
  receiptNumber?: string;
  attachedPicture?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityEntry {
  id: string;
  type: 'created' | 'updated' | 'serviced' | 'sold';
  message: string;
  carName: string;
  timestamp: string;
}

// ── Travel Order Status ────────────────────────────────────────
export type TravelOrderStatus =
  | 'PENDING'
  | 'FOR_REQUEST'
  | 'FOR_APPROVAL'
  | 'APPROVED'
  | 'ACTIVE'
  | 'COMPLETED'
  | 'CANCELLED';

// ── Vehicle ────────────────────────────────────────────────────

export interface Vehicle {
  id: string;
  plateNumber: string;
  make: string;
  model: string;
  year: number;
  color?: string;
  vehicleType?: string;
  fuelType?: string;
  underRepair?: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

// ── Driver ─────────────────────────────────────────────────────

export interface Driver {
  id: string;
  fullName: string;
  phone: string;
  email: string;
  address?: string;
  licenseNumber: string;
  expiryDate: string;
  status?: string;
  createdAt: string;
  updatedAt: string;
}

// ── GPS Trip Log ───────────────────────────────────────────────

export type TripStatus = 'departed' | 'en-route' | 'arrived' | 'cancelled' | 'completed';
export type TripType = 'OUTBOUND' | 'RETURN';

export interface GpsTripLog {
  id: string;
  gpsRecordNo: string;
  tripDate: string; // ISO date (YYYY-MM-DD)
  vehicleId: string;
  driverId: string;
  originGpsStartPoint: string;
  destinationGpsEndPoint: string;
  coordinatesOrigin?: string | null;
  coordinatesDestination?: string | null;
  actualRouteRoadTaken: string;
  departureTimeGps: string | null; // ISO datetime
  arrivalTimeGps: string | null;   // ISO datetime
  gpsDistanceKm: number;
  engineHours: number;
  maxSpeedKph: number;
  tripStatusGps: TripStatus;
  travelOrderId?: string | null;
  toStatusAuto?: string | null;
  anomalyFlag: boolean;
  notesRemarks?: string | null;
  // New fields for enhanced trip detection
  destinationVerified?: boolean;
  tripType?: TripType;
  parentTripId?: string | null;
  locationName?: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── User (App User for User Management) ────────────────────────

export interface AppUser {
  id: string;
  name: string;
  username: string;
  userType: 'SUPERADMIN' | 'ADMIN' | 'DISPATCHER' | 'HR' | 'VIEWER';
  department: string;
  picture?: string;
  createdAt: string;
  updatedAt: string;
}

// ── Generic API ────────────────────────────────────────────────

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  error?: string;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  message?: string;
}

export type SyncVehicleResult =
  | { status: 'no_travel_order' }
  | { status: 'cartrack_unavailable' }
  | { status: 'no_gps_data' }
  | { status: 'completed'; tripsCreated: number; tripsFailed: number; vehiclePlate: string };

export interface TrackingHistorySyncResult {
  success: boolean;
  fromDate: string;
  toDate: string;
  totalVehiclesProcessed: number;
  totalTripsCreated: number;
  totalTripsFailed: number;
  results: SyncVehicleResult[];
  elapsedSeconds: number;
}

export interface AdminSyncResponse {
  success: boolean;
  data: TrackingHistorySyncResult;
  message: string;
  elapsed_seconds: number;
}

// ── Notifications ────────────────────────────────────────────

export type NotificationType =
  | 'gps_alert'
  | 'travel_request'
  | 'announcement'
  | 'system';

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  targetUrl: string;
  targetTab?: string;
  entityId?: string;
  isRead: boolean;
  createdAt: string;
  readAt?: string;
}
