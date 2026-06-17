import { useState, useEffect, useCallback } from 'react';
import { Plus, Fuel, Loader2, Eye, Wrench } from 'lucide-react';
import { useNotification } from '@/shared/context/NotificationContext';
import { AddVehicleModal } from '../components/AddVehicleModal';
import { VehicleDetailsModal } from '../components/VehicleDetailsModal';
import { fetchVehicles, createVehicle } from '../api/vehicles-api';
import type { Vehicle } from '@car-tracker/shared';

interface VehiclesPageProps {
  hideAddButton?: boolean;
}

export function VehiclesPage({ hideAddButton }: VehiclesPageProps) {
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

  return (
    <div className="space-y-8">
      {!hideAddButton && (
        <div className="flex justify-end">
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-teal px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-brand-teal/80 active:scale-[0.97]"
          >
            <Plus className="size-4" />
            + Add New Vehicle
          </button>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex flex-col items-center justify-center rounded-xl bg-white px-6 py-16 text-center shadow-brand">
          <Loader2 className="size-8 text-brand-teal animate-spin mb-3" />
          <p className="text-base font-medium text-zinc-600">Loading vehicles…</p>
        </div>
      ) : vehicles.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl bg-white px-6 py-16 text-center shadow-brand">
          <p className="text-base font-medium text-zinc-600">No vehicles yet</p>
          <p className="mt-1 text-sm text-zinc-400">
            Click "+ Add New Vehicle" to get started.
          </p>
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {vehicles.map((vehicle) => (
            <div
              key={vehicle.id}
              className={`group relative rounded-xl shadow-brand transition-all hover:shadow-brand-lg ${
                vehicle.underRepair === true
                  ? 'bg-amber-50/40 ring-1 ring-amber-200'
                  : 'bg-white'
              }`}
            >
              {/* Under Repair badge — only show when underRepair is true */}
              {vehicle.underRepair === true && (
                <div className="absolute -top-2 -right-2 z-10">
                  <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase shadow-sm text-amber-600 bg-amber-50">
                    <Wrench className="size-3" />
                    Under Repair
                  </span>
                </div>
              )}

              <div className="flex items-center justify-between rounded-t-xl bg-brand-cream px-5 py-4">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">
                    {vehicle.make}
                  </p>
                  <p className="text-lg font-bold text-zinc-900">{vehicle.model}</p>
                </div>
                <span className="rounded-full bg-brand-moss/40 px-3 py-0.5 text-xs font-medium text-brand-teal">
                  {vehicle.plateNumber}
                </span>
              </div>

              <div className="space-y-3 px-5 py-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-zinc-400">Year</span>
                  <span className="font-medium text-zinc-900">{vehicle.year}</span>
                </div>
                {vehicle.color && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-zinc-400">Color</span>
                    <span className="font-medium text-zinc-900">{vehicle.color}</span>
                  </div>
                )}
                {vehicle.vehicleType && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-zinc-400">Type</span>
                    <span className="font-medium text-zinc-900">{vehicle.vehicleType}</span>
                  </div>
                )}
                {vehicle.fuelType && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-1.5 text-zinc-400">
                      <Fuel className="size-3.5" /> Fuel
                    </span>
                    <span className="font-medium capitalize text-zinc-900">
                      {vehicle.fuelType}
                    </span>
                  </div>
                )}
              </div>

              {/* View Details button */}
              <div className="border-t border-zinc-100 px-5 py-3">
                <button
                  onClick={() => handleViewDetails(vehicle)}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand-cream px-3 py-2 text-xs font-medium text-zinc-600 transition-all hover:bg-brand-moss/30 active:scale-[0.97]"
                >
                  <Eye className="size-3.5" />
                  View Details
                </button>
              </div>
            </div>
          ))}
        </div>
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
