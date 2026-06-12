import type { Car, MaintenanceRecord, ActivityEntry, User } from '@car-tracker/shared';

export const MOCK_USER: User = {
  id: '1',
  name: 'Alex Driver',
  email: 'alex.driver@fleet.com',
  username: 'alex_driver',
  role: 'Fleet Manager',
  createdAt: '2024-01-15T08:00:00Z',
};

export const MOCK_CARS: Car[] = [
  { id: '1', brand: 'Toyota', model: 'Camry', year: 2024, color: 'Silver', price: 28000, mileage: 12450, vin: '1HGCM82633A004352', status: 'available', fuelType: 'gasoline', transmission: 'automatic', createdAt: '2025-06-10T10:00:00Z', updatedAt: '2026-05-20T14:30:00Z' },
  { id: '2', brand: 'Tesla', model: 'Model 3', year: 2024, color: 'White', price: 45000, mileage: 8700, vin: '5YJ3E1EA1KF123456', status: 'in-service', fuelType: 'electric', transmission: 'automatic', createdAt: '2025-08-22T09:00:00Z', updatedAt: '2026-06-01T11:00:00Z' },
  { id: '3', brand: 'Honda', model: 'Civic', year: 2023, color: 'Blue', price: 25000, mileage: 38700, vin: '2HGFG3B53GH123456', status: 'available', fuelType: 'gasoline', transmission: 'manual', createdAt: '2024-11-05T07:00:00Z', updatedAt: '2026-04-18T16:00:00Z' },
  { id: '4', brand: 'Ford', model: 'F-150', year: 2022, color: 'Black', price: 42000, mileage: 62100, vin: '1FTFW1E53MFA12345', status: 'sold', fuelType: 'gasoline', transmission: 'automatic', createdAt: '2024-03-12T08:30:00Z', updatedAt: '2026-02-28T10:00:00Z' },
  { id: '5', brand: 'BMW', model: 'X5', year: 2025, color: 'Graphite', price: 65000, mileage: 3200, vin: '5UXCR6C02SLL67890', status: 'in-service', fuelType: 'hybrid', transmission: 'automatic', createdAt: '2026-01-10T12:00:00Z', updatedAt: '2026-05-30T09:00:00Z' },
  { id: '6', brand: 'Mercedes-Benz', model: 'Sprinter', year: 2023, color: 'White', price: 52000, mileage: 48900, vin: 'W1W9066351T123456', status: 'available', fuelType: 'diesel', transmission: 'automatic', createdAt: '2024-07-01T06:00:00Z', updatedAt: '2026-03-15T15:00:00Z' },
  { id: '7', brand: 'Chevrolet', model: 'Bolt EV', year: 2025, color: 'Red', price: 32000, mileage: 5600, vin: '1G1FZ6S0XNA123456', status: 'available', fuelType: 'electric', transmission: 'automatic', createdAt: '2026-02-18T10:00:00Z', updatedAt: '2026-06-05T08:00:00Z' },
  { id: '8', brand: 'Audi', model: 'Q7', year: 2024, color: 'Navy', price: 58000, mileage: 22100, vin: 'WA1LAAF79RD123456', status: 'in-service', fuelType: 'gasoline', transmission: 'automatic', createdAt: '2025-04-09T11:00:00Z', updatedAt: '2026-06-10T12:00:00Z' },
];

export const MOCK_MAINTENANCE: MaintenanceRecord[] = [
  { id: 'm1', carId: '1', carName: '2024 Toyota Camry', serviceType: 'Oil Change', cost: 89.99, date: '2026-05-15', notes: 'Full synthetic oil change' },
  { id: 'm2', carId: '2', carName: '2024 Tesla Model 3', serviceType: 'Tire Rotation', cost: 65.00, date: '2026-05-28', notes: 'Rotated all four tires' },
  { id: 'm3', carId: '3', carName: '2023 Honda Civic', serviceType: 'Brake Pads Replacement', cost: 350.00, date: '2026-04-10' },
  { id: 'm4', carId: '5', carName: '2025 BMW X5', serviceType: 'Software Update', cost: 0.00, date: '2026-06-01', notes: 'iDrive system update' },
  { id: 'm5', carId: '6', carName: '2023 Mercedes-Benz Sprinter', serviceType: 'Transmission Service', cost: 480.00, date: '2026-03-22' },
  { id: 'm6', carId: '8', carName: '2024 Audi Q7', serviceType: 'Annual Inspection', cost: 195.00, date: '2026-06-08', notes: 'Passed all checks' },
  { id: 'm7', carId: '2', carName: '2024 Tesla Model 3', serviceType: 'HVAC Filter', cost: 45.00, date: '2026-04-15' },
  { id: 'm8', carId: '4', carName: '2022 Ford F-150', serviceType: 'Engine Diagnostics', cost: 125.00, date: '2026-02-20', notes: 'Check engine light — resolved' },
  { id: 'm9', carId: '7', carName: '2025 Chevrolet Bolt EV', serviceType: 'Battery Check', cost: 0.00, date: '2026-06-05', notes: 'Battery health: 98%' },
  { id: 'm10', carId: '1', carName: '2024 Toyota Camry', serviceType: 'Air Filter Replacement', cost: 38.50, date: '2026-03-08' },
];

export const MOCK_ACTIVITIES: ActivityEntry[] = [
  { id: 'a1', type: 'created', message: 'added to fleet', carName: '2025 Chevrolet Bolt EV', timestamp: '2026-02-18T10:00:00Z' },
  { id: 'a2', type: 'serviced', message: 'completed Annual Inspection', carName: '2024 Audi Q7', timestamp: '2026-06-08T14:00:00Z' },
  { id: 'a3', type: 'updated', message: 'mileage updated to 3,200 mi', carName: '2025 BMW X5', timestamp: '2026-05-30T09:00:00Z' },
  { id: 'a4', type: 'serviced', message: 'Tire Rotation completed', carName: '2024 Tesla Model 3', timestamp: '2026-05-28T11:00:00Z' },
  { id: 'a5', type: 'updated', message: 'status changed to Available', carName: '2024 Toyota Camry', timestamp: '2026-05-20T14:30:00Z' },
  { id: 'a6', type: 'sold', message: 'has been sold', carName: '2022 Ford F-150', timestamp: '2026-02-28T10:00:00Z' },
  { id: 'a7', type: 'serviced', message: 'Transmission Service completed', carName: '2023 Mercedes-Benz Sprinter', timestamp: '2026-03-22T09:00:00Z' },
  { id: 'a8', type: 'created', message: 'added to fleet', carName: '2025 BMW X5', timestamp: '2026-01-10T12:00:00Z' },
];