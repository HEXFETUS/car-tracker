import { useState, useEffect, useCallback } from 'react';
import { Plus, Loader2, User, Phone, Mail, Calendar } from 'lucide-react';
import { useNotification } from '@/shared/context/NotificationContext';
import { cn } from '@/shared/lib/utils';
import { AddDriverModal } from '../components/AddDriverModal';
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

export function DriversPage() {
  const { toast, confirm } = useNotification();
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const loadDrivers = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchDrivers();
      setDrivers(data);
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

  return (
    <div className="space-y-8">
      <div className="flex justify-end">
        <button
          onClick={() => setIsModalOpen(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-teal px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-brand-teal/80 active:scale-[0.97]"
        >
          <Plus className="size-4" />
          + Add Driver
        </button>
      </div>

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
        <div className="rounded-xl bg-white shadow-brand overflow-hidden">
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-100 bg-brand-cream/50">
                  <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    Driver
                  </th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    Phone
                  </th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    Email
                  </th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    License
                  </th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    Expiry
                  </th>
                </tr>
              </thead>
              <tbody>
                {drivers.map((driver, idx) => {
                  const expired = isExpired(driver.expiryDate);
                  return (
                    <tr
                      key={driver.id}
                      className={cn(
                        'border-b border-zinc-50 transition-colors hover:bg-brand-cream/30',
                        idx % 2 === 0 ? 'bg-white' : 'bg-zinc-50/50'
                      )}
                    >
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex size-8 items-center justify-center rounded-full bg-brand-moss/50 text-sm font-semibold text-brand-teal shrink-0">
                            {driver.fullName.charAt(0)}
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-zinc-900 truncate">
                              {driver.fullName}
                            </p>
                            {driver.address && (
                              <p className="text-xs text-zinc-400 truncate">
                                {driver.address}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-zinc-700 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <Phone className="size-3.5 text-zinc-400" />
                          {driver.phone}
                        </div>
                      </td>
                      <td className="px-5 py-4 text-zinc-700 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <Mail className="size-3.5 text-zinc-400" />
                          {driver.email}
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <span className="inline-flex items-center rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 font-mono">
                          {driver.licenseNumber}
                        </span>
                      </td>
                      <td className="px-5 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <Calendar className="size-3.5 text-zinc-400" />
                          <span
                            className={cn(
                              'text-sm',
                              expired ? 'font-medium text-red-600' : 'text-zinc-700'
                            )}
                          >
                            {formatExpiryDate(driver.expiryDate)}
                            {expired && (
                              <span className="ml-1.5 rounded-md bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-red-600">
                                Expired
                              </span>
                            )}
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile card list */}
          <div className="md:hidden divide-y divide-zinc-50">
            {drivers.map((driver) => {
              const expired = isExpired(driver.expiryDate);
              return (
                <div key={driver.id} className="px-5 py-4 space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="flex size-9 items-center justify-center rounded-full bg-brand-moss/50 text-sm font-semibold text-brand-teal shrink-0">
                      {driver.fullName.charAt(0)}
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-zinc-900 truncate">
                        {driver.fullName}
                      </p>
                      <p className="text-xs text-zinc-400">{driver.licenseNumber}</p>
                    </div>
                  </div>
                  <div className="space-y-1.5 text-sm text-zinc-600">
                    <div className="flex items-center gap-2">
                      <Phone className="size-3.5 text-zinc-400" />
                      {driver.phone}
                    </div>
                    <div className="flex items-center gap-2">
                      <Mail className="size-3.5 text-zinc-400" />
                      {driver.email}
                    </div>
                    <div className="flex items-center gap-2">
                      <Calendar className="size-3.5 text-zinc-400" />
                      <span className={expired ? 'text-red-600 font-medium' : ''}>
                        {formatExpiryDate(driver.expiryDate)}
                        {expired && (
                          <span className="ml-1.5 rounded-md bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-red-600">
                            Expired
                          </span>
                        )}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Add Driver Modal */}
      <AddDriverModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleAddDriver}
      />
    </div>
  );
}