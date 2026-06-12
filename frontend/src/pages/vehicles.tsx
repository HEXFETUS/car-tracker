import { MOCK_CARS } from '@/lib/mock-data';
import { cn } from '@/lib/utils';
import { Fuel, Gauge } from 'lucide-react';

const STATUS_STYLES: Record<string, string> = {
  available: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'in-service': 'bg-amber-50 text-amber-700 border-amber-200',
  sold: 'bg-zinc-50 text-zinc-500 border-zinc-200',
};

const STATUS_LABELS: Record<string, string> = {
  available: 'Available',
  'in-service': 'In-Service',
  sold: 'Sold',
};

export function VehiclesPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl">
          Vehicles
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          {MOCK_CARS.length} vehicles in your fleet.
        </p>
      </div>

      <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {MOCK_CARS.map((car) => (
          <div
            key={car.id}
            className="group rounded-xl border bg-white shadow-sm transition-all hover:shadow-md"
          >
            {/* Card header — color accent bar */}
            <div className="flex items-center justify-between rounded-t-xl bg-zinc-50 px-5 py-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">
                  {car.brand}
                </p>
                <p className="text-lg font-bold text-zinc-900">{car.model}</p>
              </div>
              <span
                className={cn(
                  'rounded-full border px-3 py-0.5 text-xs font-medium',
                  STATUS_STYLES[car.status]
                )}
              >
                {STATUS_LABELS[car.status]}
              </span>
            </div>

            {/* Card body */}
            <div className="space-y-3 px-5 py-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-400">Year</span>
                <span className="font-medium text-zinc-900">{car.year}</span>
              </div>

              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-400">VIN</span>
                <span className="font-mono text-xs font-medium tracking-wide text-zinc-700">
                  {car.vin}
                </span>
              </div>

              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-1.5 text-zinc-400">
                  <Gauge className="size-3.5" /> Mileage
                </span>
                <span className="font-medium text-zinc-900">
                  {car.mileage?.toLocaleString()} mi
                </span>
              </div>

              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-1.5 text-zinc-400">
                  <Fuel className="size-3.5" /> Fuel
                </span>
                <span className="font-medium capitalize text-zinc-900">
                  {car.fuelType}
                </span>
              </div>

              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-400">Price</span>
                <span className="font-semibold text-zinc-900">
                  ${car.price.toLocaleString()}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}