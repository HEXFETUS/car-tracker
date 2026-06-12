import { Router, Request, Response } from 'express';
import type { Driver, ApiResponse } from '@car-tracker/shared';

const router: Router = Router();

const drivers: Driver[] = [
  {
    id: '1',
    fullName: 'Juan Dela Cruz',
    phone: '+63 917 123 4567',
    email: 'juan.delacruz@example.com',
    address: '123 Rizal Avenue, Manila, Philippines',
    licenseNumber: 'N01-12-345678',
    expiryDate: '2027-06-15',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: '2',
    fullName: 'Maria Santos',
    phone: '+63 918 234 5678',
    email: 'maria.santos@example.com',
    address: '456 Mabini Street, Quezon City, Philippines',
    licenseNumber: 'N01-12-987654',
    expiryDate: '2026-12-20',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: '3',
    fullName: 'Pedro Reyes',
    phone: '+63 919 345 6789',
    email: 'pedro.reyes@example.com',
    address: '789 Bonifacio Drive, Makati, Philippines',
    licenseNumber: 'N01-12-112233',
    expiryDate: '2028-03-10',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

// GET /api/drivers - List all drivers
router.get('/', (_req: Request, res: Response) => {
  const response: ApiResponse<Driver[]> = {
    success: true,
    data: drivers,
    message: 'Drivers retrieved successfully',
  };
  res.json(response);
});

// GET /api/drivers/:id - Get a single driver
router.get('/:id', (req: Request, res: Response) => {
  const driver = drivers.find((d) => d.id === req.params.id);
  if (!driver) {
    const response: ApiResponse<null> = {
      success: false,
      data: null,
      error: 'Driver not found',
    };
    res.status(404).json(response);
    return;
  }
  const response: ApiResponse<Driver> = {
    success: true,
    data: driver,
  };
  res.json(response);
});

// POST /api/drivers - Create a new driver
router.post('/', (req: Request, res: Response) => {
  const { fullName, phone, email, address, licenseNumber, expiryDate } = req.body;

  if (!fullName || !phone || !email || !licenseNumber || !expiryDate) {
    const response: ApiResponse<null> = {
      success: false,
      data: null,
      error: 'Full Name, Phone, Email, License Number, and Expiry Date are required',
    };
    res.status(400).json(response);
    return;
  }

  const existing = drivers.find((d) => d.licenseNumber === licenseNumber);
  if (existing) {
    const response: ApiResponse<null> = {
      success: false,
      data: null,
      error: 'A driver with this license number already exists',
    };
    res.status(409).json(response);
    return;
  }

  const newDriver: Driver = {
    id: String(drivers.length + 1),
    fullName,
    phone,
    email,
    address: address || undefined,
    licenseNumber,
    expiryDate,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  drivers.push(newDriver);

  const response: ApiResponse<Driver> = {
    success: true,
    data: newDriver,
    message: 'Driver created successfully',
  };
  res.status(201).json(response);
});

export default router;