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
        mileage: 15000,
        fuelType: 'gasoline',
        transmission: 'manual',
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