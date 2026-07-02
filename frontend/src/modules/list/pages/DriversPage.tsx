import { useState, useEffect, useCallback, useMemo } from 'react';
import { Loader2, User, Phone, Mail, Calendar, Eye, Search } from 'lucide-react';
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
  searchQuery?: string;
}

const STATUS_BADGES: Record<string, { class: string; label: string }> = {
  active: { class: 'bg-green-50 text-green-600', label: 'Active' },
  inactive: { class: 'bg-zinc-100 text-zinc-600', label: 'Inactive' },
  'on-leave': { class: 'bg-amber-50 text-amber-700', label: 'On Leave' },
  suspended: { class: 'bg-red-50 text-red-700', label: 'Suspended' },
};

export function DriversPage({ searchQuery = '' }: DriversPageProps) {
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

  // ── Filtering ──
  const filteredDrivers = useMemo(() => {
    if (!searchQuery.trim()) return drivers;
    const q = searchQuery.toLowerCase();
    return drivers.filter(
      (d) =>
        d.fullName.toLowerCase().includes(q) ||
        d.phone.toLowerCase().includes(q) ||
        d.email.toLowerCase().includes(q) ||
        d.licenseNumber.toLowerCase().includes(q) ||
        (d.address && d.address.toLowerCase().includes(q)),
    );
  }, [drivers, searchQuery]);

  // ── Stats ──
  const stats = useMemo(() => {
    const total = drivers.length;
    const active = drivers.filter((d) => d.status === 'active' || !d.status).length;
    const inactive = drivers.filter((d) => d.status === 'inactive').length;
    const onLeave = drivers.filter((d) => d.status === 'on-leave').length;
    const suspended = drivers.filter((d) => d.status === 'suspended').length;
    return { total, active, inactive, onLeave, suspended };
  }, [drivers]);

  // ── Empty state ──
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl bg-white px-6 min-h-[200px] text-center shadow-brand border border-zinc-100">
        <Loader2 className="size-7 text-brand-teal animate-spin mb-2" />
        <p className="text-sm font-medium text-zinc-500">Loading drivers...</p>
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
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-1.5 text-xs font-medium text-zinc-500 ring-1 ring-zinc-200 shadow-sm">
          <span className="flex size-2 rounded-full bg-zinc-300" />
          Inactive {stats.inactive}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-1.5 text-xs font-medium text-amber-700 ring-1 ring-amber-200 shadow-sm">
          <span className="flex size-2 rounded-full bg-amber-500" />
          On Leave {stats.onLeave}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-1.5 text-xs font-medium text-red-700 ring-1 ring-red-200 shadow-sm">
          <span className="flex size-2 rounded-full bg-red-500" />
          Suspended {stats.suspended}
        </span>
      </div>

      {/* ── Content ── */}
      {filteredDrivers.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl bg-white px-6 min-h-[240px] text-center shadow-brand border border-zinc-100">
          {searchQuery ? (
            <>
              <Search className="size-6 text-zinc-300 mb-2" />
              <p className="text-sm font-medium text-zinc-600">No matching drivers</p>
              <p className="mt-1 text-xs text-zinc-400">Try changing your search to see all records.</p>
            </>
          ) : (
            <>
              <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-zinc-100">
                <User className="size-5 text-zinc-400" />
              </div>
              <p className="text-sm font-medium text-zinc-600">No drivers yet</p>
              <p className="mt-1 text-xs text-zinc-400">Click "New Driver" to register your first driver.</p>
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
                  <th className={tableHeaderCellClass}>Name</th>
                  <th className={tableHeaderCellClass}>Phone</th>
                  <th className={tableHeaderCellClass}>Email</th>
                  <th className={tableHeaderCellClass}>License #</th>
                  <th className={tableHeaderCellClass}>Expiry</th>
                  <th className={tableHeaderCellClass}>Status</th>
                  <th className={tableHeaderCellClass}>Last Updated</th>
                  <th className={cn(tableHeaderCellClass, 'text-right')}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredDrivers.map((driver) => {
                  const expired = isExpired(driver.expiryDate);
                  const badge = STATUS_BADGES[driver.status ?? 'active'] || STATUS_BADGES.active;
                  return (
                    <tr key={driver.id} className={tableRowClass}>
                      <td className={tableCellClass}>
                        <div className="flex items-center gap-2">
                          <div className="flex size-7 items-center justify-center rounded-full bg-brand-moss/50 text-xs font-semibold text-brand-teal shrink-0">
                            {driver.fullName.charAt(0)}
                          </div>
                          <span className="font-medium text-zinc-900">{driver.fullName}</span>
                        </div>
                      </td>
                      <td className={tableCellClass}>{driver.phone}</td>
                      <td className={cn(tableCellClass, 'max-w-[180px] truncate')}>{driver.email}</td>
                      <td className={tableCellClass}>
                        <span className="inline-flex items-center rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 font-mono">
                          {driver.licenseNumber}
                        </span>
                      </td>
                      <td className={tableCellClass}>
                        <span className={expired ? 'text-red-600 font-medium' : 'text-zinc-500'}>
                          {formatExpiryDate(driver.expiryDate)}
                          {expired && <span className="ml-1 text-[10px] font-semibold uppercase text-red-600">Expired</span>}
                        </span>
                      </td>
                      <td className={tableCellClass}>
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.class}`}>
                          {badge.label}
                        </span>
                      </td>
                      <td className={tableCellClass}>
                        {new Date(driver.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </td>
                      <td className={cn(tableCellClass, 'text-right')}>
                        <button
                          onClick={() => handleViewDetails(driver)}
                          className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-brand-teal hover:bg-brand-teal/5 transition-colors"
                        >
                          <Eye className="size-3.5" />
                          View
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ── Mobile Cards ── */}
          <div className="space-y-3 md:hidden">
            {filteredDrivers.map((driver) => {
              const expired = isExpired(driver.expiryDate);
              const badge = STATUS_BADGES[driver.status ?? 'active'] || STATUS_BADGES.active;
              return (
                <div key={driver.id} className="rounded-xl bg-white p-4 shadow-brand border border-zinc-100">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="flex size-8 items-center justify-center rounded-full bg-brand-moss/50 text-sm font-semibold text-brand-teal shrink-0">
                        {driver.fullName.charAt(0)}
                      </div>
                      <div>
                        <p className="text-sm font-bold text-zinc-900">{driver.fullName}</p>
                        <p className="text-xs text-zinc-500">{driver.licenseNumber}</p>
                      </div>
                    </div>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${badge.class}`}>
                      {badge.label}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-zinc-500 mb-3">
                    <span className="flex items-center gap-1"><Phone className="size-3" /> {driver.phone}</span>
                    <span className="flex items-center gap-1 truncate"><Mail className="size-3 shrink-0" /> {driver.email}</span>
                    <span className="flex items-center gap-1">
                      <Calendar className="size-3" />
                      <span className={expired ? 'text-red-600' : ''}>{formatExpiryDate(driver.expiryDate)}</span>
                    </span>
                    {driver.address && <span className="truncate">{driver.address}</span>}
                  </div>
                  <button
                    onClick={() => handleViewDetails(driver)}
                    className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand-cream px-3 py-2 text-xs font-medium text-zinc-600 transition-all hover:bg-brand-moss/30 active:scale-[0.97]"
                  >
                    <Eye className="size-3.5" />
                    View Details
                  </button>
                </div>
              );
            })}
          </div>
        </>
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