import { Router, Request, Response } from 'express';
import type { Vehicle, ApiResponse } from '@car-tracker/shared';

const router: Router = Router();

const vehicles: Vehicle[] = [
  {
    id: '1',
    plateNumber: 'ABC 1234',
    make: 'Toyota',
    model: 'Camry',
    year: 2024,
    color: 'Silver',
    vehicleType: 'Sedan',
    fuelType: 'gasoline',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: '2',
    plateNumber: 'XYZ 5678',
    make: 'Tesla',
    model: 'Model 3',
    year: 2024,
    color: 'White',
    vehicleType: 'Sedan',
    fuelType: 'electric',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: '3',
    plateNumber: 'DEF 9012',
    make: 'Honda',
    model: 'Civic',
    year: 2023,
    color: 'Blue',
    vehicleType: 'Sedan',
    fuelType: 'gasoline',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: '4',
    plateNumber: 'GHI 3456',
    make: 'Ford',
    model: 'F-150',
    year: 2022,
    color: 'Black',
    vehicleType: 'Truck',
    fuelType: 'gasoline',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: '5',
    plateNumber: 'JKL 7890',
    make: 'BMW',
    model: 'X5',
    year: 2025,
    color: 'Graphite',
    vehicleType: 'SUV',
    fuelType: 'hybrid',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

// GET /api/vehicles - List all vehicles
router.get('/', (_req: Request, res: Response) => {
  const response: ApiResponse<Vehicle[]> = {
    success: true,
    data: vehicles,
    message: 'Vehicles retrieved successfully',
  };
  res.json(response);
});

// GET /api/vehicles/:id - Get a single vehicle
router.get('/:id', (req: Request, res: Response) => {
  const vehicle = vehicles.find((v) => v.id === req.params.id);
  if (!vehicle) {
    const response: ApiResponse<null> = {
      success: false,
      data: null,
      error: 'Vehicle not found',
    };
    res.status(404).json(response);
    return;
  }
  const response: ApiResponse<Vehicle> = {
    success: true,
    data: vehicle,
  };
  res.json(response);
});

// POST /api/vehicles - Create a new vehicle
router.post('/', (req: Request, res: Response) => {
  const { plateNumber, make, model, year, color, vehicleType, fuelType } = req.body;

  if (!plateNumber || !make || !model || !year) {
    const response: ApiResponse<null> = {
      success: false,
      data: null,
      error: 'Plate Number, Make, Model, and Year are required',
    };
    res.status(400).json(response);
    return;
  }

  const existing = vehicles.find((v) => v.plateNumber === plateNumber);
  if (existing) {
    const response: ApiResponse<null> = {
      success: false,
      data: null,
      error: 'A vehicle with this plate number already exists',
    };
    res.status(409).json(response);
    return;
  }

  const newVehicle: Vehicle = {
    id: String(vehicles.length + 1),
    plateNumber,
    make,
    model,
    year: Number(year),
    color: color || undefined,
    vehicleType: vehicleType || undefined,
    fuelType: fuelType || undefined,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  vehicles.push(newVehicle);

  const response: ApiResponse<Vehicle> = {
    success: true,
    data: newVehicle,
    message: 'Vehicle created successfully',
  };
  res.status(201).json(response);
});

export default router;