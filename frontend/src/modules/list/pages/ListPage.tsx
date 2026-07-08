import { useState, useMemo } from 'react';
import { useNotification } from '@/shared/context/NotificationContext';
import { VehiclesPage } from '@/modules/list/pages/VehiclesPage';
import { DriversPage } from '@/modules/list/pages/DriversPage';
import { MaintenancePage } from '@/modules/list/pages/MaintenancePage';
import { ListToolbar, type TabKey } from '@/modules/list/components/ListToolbar';
import { AddVehicleModal } from '@/modules/list/components/AddVehicleModal';
import { AddDriverModal } from '@/modules/list/components/AddDriverModal';
import { NewMaintenanceModal } from '@/modules/list/components/NewMaintenanceModal';
import { createVehicle } from '@/modules/list/api/vehicles-api';
import { createDriver } from '@/modules/list/api/drivers-api';
import { createMaintenance } from '@/modules/list/api/maintenance-api';

export function ListPage() {
  const { toast, confirm } = useNotification();
  const [activeTab, setActiveTab] = useState<TabKey>('vehicles');
  const [isVehicleModalOpen, setIsVehicleModalOpen] = useState(false);
  const [isDriverModalOpen, setIsDriverModalOpen] = useState(false);
  const [isMaintenanceModalOpen, setIsMaintenanceModalOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');

  const newItemLabel = useMemo(() => {
    switch (activeTab) {
      case 'vehicles': return 'New Vehicle';
      case 'drivers': return 'New Driver';
      case 'maintenance': return 'New Maintenance';
    }
  }, [activeTab]);

  function handleNewItem() {
    switch (activeTab) {
      case 'vehicles': setIsVehicleModalOpen(true); break;
      case 'drivers': setIsDriverModalOpen(true); break;
      case 'maintenance': setIsMaintenanceModalOpen(true); break;
    }
  }

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

  async function handleAddMaintenance(payload: any) {
    const confirmed = await confirm({
      title: 'Save Maintenance Record?',
      message: `You are about to record a "${payload.serviceType}" service. This action can be modified later.`,
      type: 'info',
    });
    if (!confirmed) return;

    try {
      await createMaintenance(payload);
      toast('Maintenance record added successfully!', 'success');
      setIsMaintenanceModalOpen(false);
      setRefreshKey((k) => k + 1);
    } catch (err: any) {
      toast(err.message || 'Failed to add maintenance record', 'error');
    }
  }

  return (
    <div className="space-y-3">
      {/* ── Unified Toolbar ── */}
      <ListToolbar
        activeTab={activeTab}
        onTabChange={(tab) => {
          setActiveTab(tab);
          setSearchQuery('');
        }}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onNewItem={handleNewItem}
        newItemLabel={newItemLabel}
      />

      {/* ── Tab content ── */}
      <div>
        {activeTab === 'vehicles' && (
          <VehiclesPage key={refreshKey} searchQuery={searchQuery} />
        )}
        {activeTab === 'drivers' && (
          <DriversPage key={refreshKey} searchQuery={searchQuery} />
        )}
        {activeTab === 'maintenance' && (
          <MaintenancePage key={refreshKey} searchQuery={searchQuery} />
        )}
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

      {/* Add Maintenance Modal */}
      <NewMaintenanceModal
        isOpen={isMaintenanceModalOpen}
        onClose={() => setIsMaintenanceModalOpen(false)}
        onSubmit={handleAddMaintenance}
      />
    </div>
  );
}