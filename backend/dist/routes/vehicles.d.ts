import { Router } from 'express';
declare const router: Router;
export interface VehicleRow {
    id: string;
    plate_number: string;
    make: string;
    model: string;
    year: number;
    color: string | null;
    vehicle_type: string | null;
    fuel_type: string | null;
    created_at: string;
    updated_at: string;
}
export default router;
//# sourceMappingURL=vehicles.d.ts.map