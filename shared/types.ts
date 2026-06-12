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

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  error?: string;
}
