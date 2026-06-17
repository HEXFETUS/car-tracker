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
  createdAt: string;
  updatedAt: string;
}

// ── GPS Trip Log ───────────────────────────────────────────────

export type TripStatus = 'departed' | 'en-route' | 'arrived' | 'cancelled' | 'completed';

export interface GpsTripLog {
  id: string;
  gpsRecordNo: string;
  tripDate: string; // ISO date (YYYY-MM-DD)
  vehicleId: string;
  driverId: string;
  originGpsStartPoint: string;
  destinationGpsEndPoint: string;
  actualRouteRoadTaken: string;
  departureTimeGps: string; // ISO datetime
  arrivalTimeGps: string; // ISO datetime
  gpsDistanceKm: number;
  engineHours: number;
  maxSpeedKph: number;
  tripStatusGps: TripStatus;
  travelOrderId?: string | null;
  toStatusAuto?: string | null;
  anomalyFlag: boolean;
  notesRemarks?: string | null;
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