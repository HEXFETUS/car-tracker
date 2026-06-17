import { useState, useEffect, useCallback } from 'react';
import { Plus, Loader2, User, Phone, Mail, Calendar, Eye } from 'lucide-react';
import { useNotification } from '@/shared/context/NotificationContext';
import { AddDriverModal } from '../components/AddDriverModal';
import { DriverDetailsModal } from '../components/DriverDetailsModal';
import { fetchDrivers, createDriver } from '../api/drivers-api';
import type { Driver } from '@car-tracker/shared';

function formatExpiryDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function isExpired(dateStr: string): boolean {
  return new Date(dateStr) < new Date();
}

interface DriversPageProps {
  hideAddButton?: boolean;
}

export function DriversPage({ hideAddButton }: DriversPageProps) {
  const { toast, confirm } = useNotification();
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
  const [selectedDriver, setSelectedDriver] = useState<Driver | null>(null);
  const loadDrivers = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchDrivers();
      setDrivers(data.sort((a, b) => a.fullName.localeCompare(b.fullName)));
    } catch {
      toast('Failed to load drivers', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadDrivers();
  }, [loadDrivers]);

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
      setIsModalOpen(false);
      await loadDrivers();
    } catch (err: any) {
      toast(err.message || 'Failed to add driver', 'error');
    }
  }

  function handleViewDetails(driver: Driver) {
    setSelectedDriver(driver);
    setIsDetailsModalOpen(true);
  }

  function handleCloseDetails() {
    setIsDetailsModalOpen(false);
    setSelectedDriver(null);
  }

  return (
    <div className="space-y-8">
      {!hideAddButton && (
        <div className="flex justify-end">
          <button
            onClick={() => setIsModalOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-teal px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-brand-teal/80 active:scale-[0.97]"
          >
            <Plus className="size-4" />
            + Add Driver
          </button>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex flex-col items-center justify-center rounded-xl bg-white px-6 py-16 text-center shadow-brand">
          <Loader2 className="size-8 text-brand-teal animate-spin mb-3" />
          <p className="text-base font-medium text-zinc-600">Loading drivers...</p>
        </div>
      ) : drivers.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl bg-white px-6 py-16 text-center shadow-brand">
          <User className="size-10 text-zinc-300 mb-3" />
          <p className="text-base font-medium text-zinc-600">No drivers yet</p>
          <p className="mt-1 text-sm text-zinc-400">
            Click "+ Add Driver" to register your first driver.
          </p>
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {drivers.map((driver) => {
            const expired = isExpired(driver.expiryDate);
            return (
              <div
                key={driver.id}
                className={`group relative rounded-xl shadow-brand transition-all hover:shadow-brand-lg ${
                  driver.status && driver.status !== 'active'
                    ? 'bg-amber-50/40 ring-1 ring-amber-200'
                    : 'bg-white'
                }`}
              >
                {/* Status badges - top right */}
                <div className="absolute -top-2 -right-2 z-10 flex flex-col gap-1 items-end">
                  {driver.status && driver.status !== 'active' && (
                    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase shadow-sm ${
                      driver.status === 'inactive'
                        ? 'bg-zinc-100 text-zinc-600'
                        : driver.status === 'on-leave'
                        ? 'bg-amber-50 text-amber-700'
                        : driver.status === 'suspended'
                        ? 'bg-red-50 text-red-700'
                        : 'bg-zinc-100 text-zinc-600'
                    }`}>
                      {driver.status === 'on-leave' ? 'On Leave' : driver.status.charAt(0).toUpperCase() + driver.status.slice(1)}
                    </span>
                  )}
                  {expired && (
                    <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase shadow-sm text-red-600 bg-red-50">
                      Expired
                    </span>
                  )}
                </div>

                {/* Header */}
                <div className="flex items-center justify-between rounded-t-xl bg-brand-cream px-5 py-4">
                  <div className="flex items-center gap-3">
                    <div className="flex size-9 items-center justify-center rounded-full bg-brand-moss/50 text-sm font-semibold text-brand-teal shrink-0">
                      {driver.fullName.charAt(0)}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-zinc-900 truncate">
                        {driver.fullName}
                      </p>
                      {driver.address && (
                        <p className="text-xs text-zinc-400 truncate">
                          {driver.address}
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Body */}
                <div className="space-y-3 px-5 py-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-zinc-400">Phone</span>
                    <span className="flex items-center gap-1 font-medium text-zinc-900">
                      <Phone className="size-3.5 text-zinc-400" />
                      {driver.phone}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-sm">
                    <span className="text-zinc-400">Email</span>
                    <span className="flex items-center gap-1 font-medium text-zinc-900 truncate max-w-[180px]">
                      <Mail className="size-3.5 text-zinc-400 shrink-0" />
                      <span className="truncate">{driver.email}</span>
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-sm">
                    <span className="text-zinc-400">License</span>
                    <span className="inline-flex items-center rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 font-mono">
                      {driver.licenseNumber}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-sm">
                    <span className="text-zinc-400">Expiry</span>
                    <span className="flex items-center gap-1 font-medium">
                      <Calendar className="size-3.5 text-zinc-400" />
                      <span className={expired ? 'text-red-600' : 'text-zinc-900'}>
                        {formatExpiryDate(driver.expiryDate)}
                      </span>
                    </span>
                  </div>

                  {driver.address && (
                    <div className="flex items-start justify-between text-sm">
                      <span className="text-zinc-400">Address</span>
                      <span className="font-medium text-zinc-900 text-right max-w-[200px]">
                        {driver.address}
                      </span>
                    </div>
                  )}
                </div>

                {/* Footer - Actions */}
                <div className="border-t border-zinc-100 px-5 py-3">
                  <button
                    onClick={() => handleViewDetails(driver)}
                    className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand-cream px-3 py-2 text-xs font-medium text-zinc-600 transition-all hover:bg-brand-moss/30 active:scale-[0.97]"
                  >
                    <Eye className="size-3.5" />
                    View Details
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add Driver Modal */}
      <AddDriverModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleAddDriver}
      />

      {/* Driver Details Modal */}
      <DriverDetailsModal
        isOpen={isDetailsModalOpen}
        onClose={handleCloseDetails}
        onSuccess={loadDrivers}
        driver={selectedDriver}
      />
    </div>
  );
}