import { useState, useEffect, useCallback, useMemo } from 'react';
import { Loader2, Eye, Wrench, Search } from 'lucide-react';
import { useNotification } from '@/shared/context/NotificationContext';
import { cn } from '@/shared/lib/utils';
import {
  tableContainerClass,
  tableClass,
  tableHeaderClass,
  tableHeaderCellClass,
  tableRowClass,
  tableCellClass,
} from '@/shared/styles/table-constants';
import { AddVehicleModal } from '../components/AddVehicleModal';
import { VehicleDetailsModal } from '../components/VehicleDetailsModal';
import { fetchVehicles, createVehicle } from '../api/vehicles-api';
import type { Vehicle } from '@car-tracker/shared';

interface VehiclesPageProps {
  searchQuery?: string;
}

export function VehiclesPage({ searchQuery = '' }: VehiclesPageProps) {
  const { toast, confirm } = useNotification();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);

  const loadVehicles = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchVehicles();
      setVehicles(data);
    } catch (err) {
      toast('Failed to load vehicles', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadVehicles();
  }, [loadVehicles]);

  async function handleAddVehicle(payload: {
    plateNumber: string;
    make: string;
    model: string;
    year: number;
    color?: string;
    vehicleType?: string;
    fuelType?: string;
  }) {
    const confirmed = await confirm({
      title: 'Save Vehicle?',
      message: `You are about to add "${payload.year} ${payload.make} ${payload.model}" (${payload.plateNumber}) to your fleet. This action can be modified later.`,
      type: 'info',
    });
    if (!confirmed) return;

    try {
      await createVehicle(payload);
      toast('Vehicle added successfully!', 'success');
      setIsAddModalOpen(false);
      await loadVehicles();
    } catch (err: any) {
      toast(err.message || 'Failed to add vehicle', 'error');
    }
  }

  function handleViewDetails(vehicle: Vehicle) {
    setSelectedVehicle(vehicle);
    setIsDetailsModalOpen(true);
  }

  function handleCloseDetails() {
    setIsDetailsModalOpen(false);
    setSelectedVehicle(null);
  }

  // ── Filtering ──
  const filteredVehicles = useMemo(() => {
    if (!searchQuery.trim()) return vehicles;
    const q = searchQuery.toLowerCase();
    return vehicles.filter(
      (v) =>
        v.plateNumber.toLowerCase().includes(q) ||
        v.make.toLowerCase().includes(q) ||
        v.model.toLowerCase().includes(q) ||
        (v.vehicleType && v.vehicleType.toLowerCase().includes(q)) ||
        (v.color && v.color.toLowerCase().includes(q)) ||
        (v.fuelType && v.fuelType.toLowerCase().includes(q)),
    );
  }, [vehicles, searchQuery]);

  // ── Stats ──
  const stats = useMemo(() => {
    const total = vehicles.length;
    const active = vehicles.filter((v) => !v.underRepair).length;
    const underRepair = vehicles.filter((v) => v.underRepair === true).length;
    return { total, active, underRepair };
  }, [vehicles]);

  // ── Empty state ──
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl bg-white px-6 min-h-[200px] text-center shadow-brand border border-zinc-100">
        <Loader2 className="size-7 text-brand-teal animate-spin mb-2" />
        <p className="text-sm font-medium text-zinc-500">Loading vehicles…</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* ── Stats Pills ── */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-1.5 text-xs font-medium text-zinc-600 ring-1 ring-zinc-200 shadow-sm">
          <span className="flex size-2 rounded-full bg-zinc-400" />
          Total {stats.total}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-1.5 text-xs font-medium text-green-700 ring-1 ring-green-200 shadow-sm">
          <span className="flex size-2 rounded-full bg-green-500" />
          Active {stats.active}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-1.5 text-xs font-medium text-amber-700 ring-1 ring-amber-200 shadow-sm">
          <span className="flex size-2 rounded-full bg-amber-500" />
          Under Repair {stats.underRepair}
        </span>
      </div>

      {/* ── Content ── */}
      {filteredVehicles.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl bg-white px-6 min-h-[240px] text-center shadow-brand border border-zinc-100">
          {searchQuery ? (
            <>
              <Search className="size-6 text-zinc-300 mb-2" />
              <p className="text-sm font-medium text-zinc-600">No matching vehicles</p>
              <p className="mt-1 text-xs text-zinc-400">Try changing your search to see all records.</p>
            </>
          ) : (
            <>
              <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-zinc-100">
                <CarIcon className="size-5 text-zinc-400" />
              </div>
              <p className="text-sm font-medium text-zinc-600">No vehicles yet</p>
              <p className="mt-1 text-xs text-zinc-400">Click "New Vehicle" to get started.</p>
            </>
          )}
        </div>
      ) : (
        <>
          {/* ── Desktop Table ── */}
          <div className={tableContainerClass}>
            <table className={tableClass}>
              <thead>
                <tr className={tableHeaderClass}>
                  <th className={tableHeaderCellClass}>Plate #</th>
                  <th className={tableHeaderCellClass}>Make / Model</th>
                  <th className={tableHeaderCellClass}>Year</th>
                  <th className={tableHeaderCellClass}>Type</th>
                  <th className={tableHeaderCellClass}>Fuel</th>
                  <th className={tableHeaderCellClass}>Status</th>
                  <th className={tableHeaderCellClass}>Last Updated</th>
                  <th className={cn(tableHeaderCellClass, 'text-right')}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredVehicles.map((vehicle) => (
                  <tr key={vehicle.id} className={tableRowClass}>
                    <td className={tableCellClass}>{vehicle.plateNumber}</td>
                    <td className={tableCellClass}>{vehicle.make} {vehicle.model}</td>
                    <td className={tableCellClass}>{vehicle.year}</td>
                    <td className={tableCellClass}>{vehicle.vehicleType || '—'}</td>
                    <td className={tableCellClass}>{vehicle.fuelType || '—'}</td>
                    <td className={tableCellClass}>
                      {vehicle.underRepair ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-600">
                          <Wrench className="size-3" />
                          Repair
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-600">
                          <span className="size-1.5 rounded-full bg-green-500" />
                          Active
                        </span>
                      )}
                    </td>
                    <td className={tableCellClass}>
                      {new Date(vehicle.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </td>
                    <td className={cn(tableCellClass, 'text-right')}>
                      <button
                        onClick={() => handleViewDetails(vehicle)}
                        className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-brand-teal hover:bg-brand-teal/5 transition-colors"
                      >
                        <Eye className="size-3.5" />
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── Mobile Cards ── */}
          <div className="space-y-3 md:hidden">
            {filteredVehicles.map((vehicle) => (
              <div key={vehicle.id} className="rounded-xl bg-white p-4 shadow-brand border border-zinc-100">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="text-sm font-bold text-zinc-900">{vehicle.plateNumber}</p>
                    <p className="text-xs text-zinc-500">{vehicle.make} {vehicle.model} ({vehicle.year})</p>
                  </div>
                  {vehicle.underRepair ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-600">
                      <Wrench className="size-3" />
                      Repair
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-medium text-green-600">
                      <span className="size-1.5 rounded-full bg-green-500" />
                      Active
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs text-zinc-500 mb-3">
                  {vehicle.vehicleType && <span>Type: {vehicle.vehicleType}</span>}
                  {vehicle.fuelType && <span className="capitalize">Fuel: {vehicle.fuelType}</span>}
                  {vehicle.color && <span>Color: {vehicle.color}</span>}
                </div>
                <button
                  onClick={() => handleViewDetails(vehicle)}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand-cream px-3 py-2 text-xs font-medium text-zinc-600 transition-all hover:bg-brand-moss/30 active:scale-[0.97]"
                >
                  <Eye className="size-3.5" />
                  View Details
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Add Vehicle Modal */}
      <AddVehicleModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onSubmit={handleAddVehicle}
      />

      {/* Vehicle Details Modal */}
      <VehicleDetailsModal
        isOpen={isDetailsModalOpen}
        onClose={handleCloseDetails}
        onSuccess={loadVehicles}
        vehicle={selectedVehicle}
      />
    </div>
  );
}

/** Small inline Car icon */
function CarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 17h14M5 17a2 2 0 01-2-2V9a2 2 0 012-2h1l2-3h8l2 3h1a2 2 0 012 2v6a2 2 0 01-2 2M5 17a2 2 0 002 2h10a2 2 0 002-2" />
    </svg>
  );
}