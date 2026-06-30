// ── Trip History Filters ──────────────────────────────────────
//
// Filter controls for Trip History: Vehicle dropdown and single Date picker.

import { Car, Calendar, X } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import type { VehicleOption } from '../api/gps-logs-api';

interface TripHistoryFiltersProps {
  vehicleFilter: string;
  dateFilter: string;
  vehicles: VehicleOption[];
  vehiclesLoading: boolean;
  onVehicleChange: (value: string) => void;
  onDateChange: (value: string) => void;
  onApply: () => void;
  onClear: () => void;
}

export function TripHistoryFilters({
  vehicleFilter,
  dateFilter,
  vehicles,
  vehiclesLoading,
  onVehicleChange,
  onDateChange,
  onApply,
  onClear,
}: TripHistoryFiltersProps) {
  const today = new Date().toISOString().split('T')[0];
  const hasFilters = vehicleFilter !== '' || dateFilter !== '';

  return (
    <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end gap-3">
      {/* Vehicle Filter */}
      <div className="flex flex-col gap-1.5 w-full sm:w-auto">
        <label className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Vehicle</label>
        <div className="relative flex-1 sm:flex-initial">
          <Car className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-brand-teal pointer-events-none" />
          <select
            value={vehicleFilter}
            onChange={(e) => onVehicleChange(e.target.value)}
            className="w-full rounded-lg border-0 bg-white pl-10 pr-8 py-2.5 text-sm font-medium text-zinc-700 ring-1 ring-brand-sage hover:ring-brand-teal focus:outline-none focus:ring-2 focus:ring-brand-teal/30 transition-shadow shadow-sm appearance-none cursor-pointer"
          >
            <option value="">All Vehicles</option>
            {vehiclesLoading && <option value="" disabled>Loading…</option>}
            {!vehiclesLoading && vehicles.map((v) => (
              <option key={v.id} value={v.id}>{v.plateNumber}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Date Filter */}
      <div className="flex flex-col gap-1.5 w-full sm:w-auto">
        <label className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Date</label>
        <div className="relative flex-1 sm:flex-initial">
          <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-brand-teal pointer-events-none" />
          <input
            type="date"
            value={dateFilter}
            max={today}
            onChange={(e) => onDateChange(e.target.value)}
            className="w-full rounded-lg border-0 bg-white pl-10 pr-3 py-2.5 text-sm font-medium text-zinc-700 ring-1 ring-brand-sage hover:ring-brand-teal focus:outline-none focus:ring-2 focus:ring-brand-teal/30 transition-shadow shadow-sm"
          />
        </div>
      </div>

      {/* Apply / Clear Buttons */}
      <div className="flex items-center gap-2">
        <button
          onClick={onApply}
          disabled={!hasFilters}
          className={cn(
            'inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-all active:scale-[0.97]',
            hasFilters ? 'bg-brand-teal hover:bg-brand-teal/80' : 'bg-brand-teal/50 cursor-not-allowed',
          )}
        >
          Apply Filters
        </button>
        {hasFilters && (
          <button
            onClick={onClear}
            className="inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-zinc-600 bg-zinc-100 hover:bg-zinc-200 transition-colors"
          >
            <X className="size-4" />
            Clear Filters
          </button>
        )}
      </div>
    </div>
  );
}