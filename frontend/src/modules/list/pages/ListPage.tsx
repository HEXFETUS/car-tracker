import { useState } from 'react';
import { Plus, Car, Users, Wrench } from 'lucide-react';
import { useNotification } from '@/shared/context/NotificationContext';
import { VehiclesPage } from '@/modules/vehicles/pages/VehiclesPage';
import { DriversPage } from '@/modules/drivers/pages/DriversPage';
import { MaintenancePage } from '@/modules/maintenance/pages/MaintenancePage';
import { AddVehicleModal } from '@/modules/vehicles/components/AddVehicleModal';
import { AddDriverModal } from '@/modules/drivers/components/AddDriverModal';
import { createVehicle } from '@/modules/vehicles/api/vehicles-api';
import { createDriver } from '@/modules/drivers/api/drivers-api';

type TabKey = 'vehicles' | 'drivers' | 'maintenance';

const TABS: { key: TabKey; label: string; icon: typeof Car }[] = [
  { key: 'vehicles', label: 'Vehicles', icon: Car },
  { key: 'drivers', label: 'Drivers', icon: Users },
  { key: 'maintenance', label: 'Maintenance', icon: Wrench },
];

export function ListPage() {
  const { toast, confirm } = useNotification();
  const [activeTab, setActiveTab] = useState<TabKey>('vehicles');
  const [isVehicleModalOpen, setIsVehicleModalOpen] = useState(false);
  const [isDriverModalOpen, setIsDriverModalOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

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
      setIsVehicleModalOpen(false);
      setRefreshKey((k) => k + 1);
    } catch (err: any) {
      toast(err.message || 'Failed to add vehicle', 'error');
    }
  }

  async function handleAddDriver(payload: {
    fullName: string;
    phone: string;
    email: string;
    address?: string;
    licenseNumber: string;
    expiryDate: string;
  }) {
    const confirmed = await confirm({
      title: 'Save Driver?',
      message: `You are about to register "${payload.fullName}" as a new driver. This action can be modified later.`,
      type: 'info',
    });
    if (!confirmed) return;

    try {
      await createDriver(payload);
      toast('Driver added successfully!', 'success');
      setIsDriverModalOpen(false);
      setRefreshKey((k) => k + 1);
    } catch (err: any) {
      toast(err.message || 'Failed to add driver', 'error');
    }
  }

  return (
    <div className="space-y-8">
      {/* Tab Bar + Action button — mobile: separate, desktop: inline */}
      <div className="space-y-3 sm:space-y-0 sm:flex sm:items-center sm:justify-between border-b border-zinc-200">
        <nav className="-mb-px flex gap-4 sm:gap-6 overflow-x-auto pb-px" aria-label="List tabs">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`
                shrink-0 whitespace-nowrap border-b-2 px-1 py-3 text-sm font-medium transition-colors
                ${
                  activeTab === tab.key
                    ? 'border-brand-teal text-brand-teal'
                    : 'border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-700'
                }
              `}
              aria-current={activeTab === tab.key ? 'page' : undefined}
            >
              <tab.icon className="inline size-4 mr-1.5 -mt-0.5" />
              {tab.label}
            </button>
          ))}
        </nav>

        {/* Mobile: small right-aligned buttons */}
        <div className="flex justify-end sm:hidden">
          {activeTab === 'vehicles' && (
            <button
              onClick={() => setIsVehicleModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-teal px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-all hover:bg-brand-teal/80 active:scale-[0.97]"
            >
              <Plus className="size-3.5" />
              Add New Vehicle
            </button>
          )}
          {activeTab === 'drivers' && (
            <button
              onClick={() => setIsDriverModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-teal px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-all hover:bg-brand-teal/80 active:scale-[0.97]"
            >
              <Plus className="size-3.5" />
              Add Driver
            </button>
          )}
        </div>

        {/* Desktop: original buttons */}
        {activeTab === 'vehicles' && (
          <button
            onClick={() => setIsVehicleModalOpen(true)}
            className="hidden sm:inline-flex items-center justify-center gap-2 rounded-lg bg-brand-teal px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-brand-teal/80 active:scale-[0.97]"
          >
            <Plus className="size-4" />
            Add New Vehicle
          </button>
        )}
        {activeTab === 'drivers' && (
          <button
            onClick={() => setIsDriverModalOpen(true)}
            className="hidden sm:inline-flex items-center justify-center gap-2 rounded-lg bg-brand-teal px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-brand-teal/80 active:scale-[0.97]"
          >
            <Plus className="size-4" />
            Add Driver
          </button>
        )}
      </div>

      {/* Tab content */}
      <div>
        {activeTab === 'vehicles' && <VehiclesPage key={refreshKey} hideAddButton />}
        {activeTab === 'drivers' && <DriversPage key={refreshKey} hideAddButton />}
        {activeTab === 'maintenance' && <MaintenancePage />}
      </div>

      {/* Add Vehicle Modal */}
      <AddVehicleModal
        isOpen={isVehicleModalOpen}
        onClose={() => setIsVehicleModalOpen(false)}
        onSubmit={handleAddVehicle}
      />

      {/* Add Driver Modal */}
      <AddDriverModal
        isOpen={isDriverModalOpen}
        onClose={() => setIsDriverModalOpen(false)}
        onSubmit={handleAddDriver}
      />
    </div>
  );
}
