import { Router } from 'express';
const router = Router();
const sampleCars = [
    {
        id: '1',
        brand: 'Toyota',
        model: 'Camry',
        year: 2024,
        color: 'Silver',
        price: 28000,
        mileage: 12450,
        vin: '1HGCM82633A004352',
        status: 'available',
        fuelType: 'gasoline',
        transmission: 'automatic',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    },
    {
        id: '2',
        brand: 'Tesla',
        model: 'Model 3',
        year: 2024,
        color: 'White',
        price: 45000,
        mileage: 8700,
        vin: '5YJ3E1EA1KF123456',
        status: 'in-service',
        fuelType: 'electric',
        transmission: 'automatic',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    },
    {
        id: '3',
        brand: 'Honda',
        model: 'Civic',
        year: 2023,
        color: 'Blue',
        price: 25000,
        mileage: 38700,
        vin: '2HGFG3B53GH123456',
        status: 'available',
        fuelType: 'gasoline',
        transmission: 'manual',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    },
    {
        id: '4',
        brand: 'Ford',
        model: 'F-150',
        year: 2022,
        color: 'Black',
        price: 42000,
        mileage: 62100,
        vin: '1FTFW1E53MFA12345',
        status: 'sold',
        fuelType: 'gasoline',
        transmission: 'automatic',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    },
    {
        id: '5',
        brand: 'BMW',
        model: 'X5',
        year: 2025,
        color: 'Graphite',
        price: 65000,
        mileage: 3200,
        vin: '5UXCR6C02SLL67890',
        status: 'in-service',
        fuelType: 'hybrid',
        transmission: 'automatic',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    },
];
router.get('/', (_req, res) => {
    const response = {
        success: true,
        data: sampleCars,
        message: 'Cars retrieved successfully',
    };
    res.json(response);
});
router.get('/:id', (req, res) => {
    const car = sampleCars.find((c) => c.id === req.params.id);
    if (!car) {
        const response = {
            success: false,
            data: null,
            error: 'Car not found',
        };
        res.status(404).json(response);
        return;
    }
    const response = {
        success: true,
        data: car,
    };
    res.json(response);
});
export default router;
//# sourceMappingURL=cars.js.map